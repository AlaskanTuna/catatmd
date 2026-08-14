#!/usr/bin/env node
// SessionStart guard: report a local .env that disagrees with the repository.
//
// .env is gitignored, so no diff, no reviewer and no CI run can ever say that
// two checkouts hold different values. .worktreeinclude copies .env into a
// worktree once, at creation time, and never refreshes it. backend/src/config/
// env.ts resolves .env relative to itself, so each checkout silently reads its
// own copy. A stale value therefore boots clean and fails somewhere else, which
// is strictly worse than the empty .env the copy mechanism was written to
// prevent (issue #97).
//
// Two comparisons, because neither covers the other:
//
//   A. .env against .env.example, for keys the example assigns a real value.
//      Needs no git relationship, so it works in a worktree, a separate clone,
//      or the main checkout.
//   B. .env against the main checkout's .env, when this is a linked worktree.
//      The only way to catch a rotated secret or a changed database URL, since
//      those values are secret and cannot be compared against anything tracked.
//
// Never prints a value from .env, on either side. Check A prints the value from
// .env.example, which is tracked and therefore already public.
//
// Any internal failure exits 0 without a verdict. A broken guard must never be
// able to wedge a session.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const read = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const parseEnv = (text) => {
  const out = new Map()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const quote = value.length > 1 && (value[0] === '"' || value[0] === "'") ? value[0] : ''
    // Mirror dotenv, which is what actually loads this file: quotes delimit the
    // value, and an unquoted value ends at the first inline comment. Diverging
    // here would report a difference the running app does not see.
    if (quote) {
      const close = value.indexOf(quote, 1)
      value = close === -1 ? value.slice(1) : value.slice(1, close)
    } else {
      value = value.split(/\s+#/)[0].trim()
    }
    out.set(key, value)
  }
  return out
}

// A key is safe to compare by value only if .env.example assigns it one. The
// example is tracked, so any value in it is already published; the secrets are
// exactly the entries left empty (QWEN_API_KEY=, BETTER_AUTH_SECRET=). Angle
// brackets are the repo's placeholder convention, which no real .env matches.
const isPublic = (value) => value !== '' && !(value.includes('<') && value.includes('>'))

// Absence is safe: an unset key falls through to the EnvSchema default, which
// carries the pinned value. Only a stale override is dangerous, so only keys
// the local .env actually sets are compared.
const checkAgainstExample = (local, example) => {
  const findings = []
  for (const [key, value] of example) {
    if (!isPublic(value) || !local.has(key)) continue
    if (local.get(key) !== value) findings.push(`  ${key} (.env.example pins ${value})`)
  }
  return findings
}

const checkAgainstMainCheckout = (local, main) => {
  const findings = []
  for (const key of new Set([...local.keys(), ...main.keys()])) {
    if (!main.has(key)) findings.push(`  ${key} (set here, absent there)`)
    else if (!local.has(key)) findings.push(`  ${key} (absent here, set there)`)
    else if (local.get(key) !== main.get(key)) findings.push(`  ${key} (differs)`)
  }
  return findings.sort()
}

// GIT_DIR != GIT_COMMON_DIR is also true inside a submodule, hence the guard.
// Both come from .agents/skills/using-git-worktrees/SKILL.md step 0.
const mainCheckoutRoot = (root) => {
  if (git(root, 'rev-parse', '--show-superproject-working-tree')) return null
  const gitDir = git(root, 'rev-parse', '--absolute-git-dir')
  const commonDir = git(root, 'rev-parse', '--git-common-dir')
  if (!gitDir || !commonDir) return null
  const common = resolve(root, commonDir)
  return gitDir === common ? null : dirname(common)
}

// CLAUDE_PROJECT_DIR first, and it is what the harness sets: inside a worktree
// it is the worktree root, which is exactly what we want to inspect. The git
// fallback is only for a manual run, and it is second because a home directory
// that happens to be a repository would otherwise resolve above the project.
const main = () => {
  const root =
    process.env.CLAUDE_PROJECT_DIR ||
    git(process.cwd(), 'rev-parse', '--show-toplevel') ||
    process.cwd()
  const localText = read(resolve(root, '.env'))
  if (localText === null) return

  const local = parseEnv(localText)
  const sections = []

  const exampleText = read(resolve(root, '.env.example'))
  if (exampleText !== null) {
    const findings = checkAgainstExample(local, parseEnv(exampleText))
    if (findings.length) {
      sections.push(`Your .env overrides a value the repository pins:\n${findings.join('\n')}`)
    }
  }

  const mainRoot = mainCheckoutRoot(root)
  if (mainRoot) {
    const mainText = read(resolve(mainRoot, '.env'))
    if (mainText !== null) {
      const findings = checkAgainstMainCheckout(local, parseEnv(mainText))
      if (findings.length) {
        sections.push(
          `This worktree's .env disagrees with the main checkout at ${mainRoot}:\n${findings.join('\n')}`,
        )
      }
    }
  }

  if (!sections.length) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: [
          '.env drift detected (issue #97). Values from .env are deliberately not shown.',
          '',
          sections.join('\n\n'),
          '',
          'Each line may be a deliberate local override or a stale copy. Tell the user what',
          'disagrees and let them decide; do not edit .env to resolve it.',
        ].join('\n'),
      },
    }),
  )
}

try {
  main()
} catch {
  // Unreadable file, missing git, anything: stay out of the way.
}
process.exit(0)

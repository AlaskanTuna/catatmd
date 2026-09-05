#!/usr/bin/env node
// PreToolUse guard: refuse the destructive git operations AGENTS.md forbids.
//
// The Critical Do-Nots ban force-pushing, rewriting published history, and
// deleting branches other than a merged feature branch. Until now those were
// prose only. This turns the ones a command can be recognised by into a denial.
//
// Deliberately narrow. The sanctioned workflow must keep working, so a plain
// `git push`, `git push -u origin <branch>`, `git rebase` of an unpushed branch,
// `git commit --amend` before pushing, and `gh pr merge --squash --delete-branch`
// all pass. History rewriting is gated at the point it becomes public, which is
// the force push, rather than at every local command that could precede one.
//
// Each pattern stops at ';', '&', '|' or a newline so a match cannot leak across
// a command boundary: in `git push && rm -rf x`, the `-rf` belongs to rm, not to
// push. Patterns are unanchored, so an `rtk git push --force` prefix is caught.
//
// A denial is not a dead end. The human can run the command themselves with the
// `!` prefix, which is the authorization AGENTS.md asks for.
//
// Any internal failure exits 0 without a verdict. A broken guard must never be
// able to wedge a session.

import { readFileSync } from 'node:fs'

const RULES = [
  {
    name: 'force push',
    re: /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*(?:--force(?:-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))/,
    fix: 'push without --force. Rewriting published history needs explicit human authorization',
  },
  {
    name: 'hard reset',
    re: /\bgit\b[^;&|\n]*\breset\b[^;&|\n]*--hard\b/,
    fix: 'use `git restore <path>` for working-tree changes, or `git revert` to undo a commit without discarding it',
  },
  {
    name: 'force branch delete',
    re: /\bgit\b[^;&|\n]*\bbranch\b[^;&|\n]*\s-D(?=\s|$)/,
    fix: 'a merged feature branch is deleted by `gh pr merge --squash --delete-branch`; use `-d` if it really is merged',
  },
  {
    name: 'force clean',
    re: /\bgit\b[^;&|\n]*\bclean\b[^;&|\n]*\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)/,
    fix: 'remove the specific files instead, so untracked work is not swept up with them',
  },
  {
    name: 'wholesale working-tree discard',
    re: /\bgit\b[^;&|\n]*\b(?:checkout|restore)\b[^;&|\n]*\s\.(?=\s|$)/,
    fix: 'name the paths to discard rather than the whole tree',
  },
  {
    name: 'history rewrite',
    re: /\bgit\b[^;&|\n]*\bfilter-branch\b/,
    fix: 'rewriting published history is a Critical Do-Not',
  },
]

const main = () => {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  if (payload?.tool_name !== 'Bash') return

  const command = payload?.tool_input?.command
  if (typeof command !== 'string' || !command.includes('git')) return

  const hit = RULES.find((rule) => rule.re.test(command))
  if (!hit) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `AGENTS.md forbids this (${hit.name}): ${hit.fix}. If this is genuinely intended, the human runs it themselves with the \`!\` prefix.`,
      },
    }),
  )
}

try {
  main()
} catch {
  // Malformed payload, unreadable stdin, anything: stay out of the way.
}
process.exit(0)

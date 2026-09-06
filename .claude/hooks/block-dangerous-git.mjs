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
// **A denial IS a dead end, and that is the point for two of these.** An earlier
// version of this comment said the human could run the command themselves with
// the `!` prefix. That is not true: `!` runs through the same PreToolUse
// pipeline, so a denial denies the human too. Anything genuinely needed has to
// be run from a terminal outside the session.
//
// So the verdict is per rule rather than uniform. `deny` is reserved for the two
// Critical Do-Nots that are absolute, force-pushing and rewriting published
// history. The rest return `ask`, which surfaces a prompt: the agent still
// cannot do it silently, which is the whole purpose, but the human retains a
// working way to say yes. Force branch delete is the clearest case, because
// AGENTS.md explicitly permits deleting a merged feature branch and a squash
// merge leaves exactly such a branch that `-d` refuses.
//
// Any internal failure exits 0 without a verdict. A broken guard must never be
// able to wedge a session.

import { readFileSync } from 'node:fs'

const RULES = [
  {
    name: 'force push',
    re: /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*(?:--force(?:-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))/,
    fix: 'push without --force. Rewriting published history needs explicit human authorization',
    decision: 'deny',
  },
  {
    name: 'hard reset',
    re: /\bgit\b[^;&|\n]*\breset\b[^;&|\n]*--hard\b/,
    fix: 'use `git restore <path>` for working-tree changes, or `git revert` to undo a commit without discarding it',
  },
  {
    name: 'force branch delete',
    re: /\bgit\b[^;&|\n]*\bbranch\b[^;&|\n]*\s-D(?=\s|$)/,
    fix: 'a merged feature branch is deleted by `gh pr merge --squash --delete-branch`, and `-d` covers a branch git can see is merged. Approve this only for a branch whose work is already on `main`, which after a squash merge `-d` refuses even though it is',
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
    decision: 'deny',
  },
]

const main = () => {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  if (payload?.tool_name !== 'Bash') return

  const command = payload?.tool_input?.command
  if (typeof command !== 'string' || !command.includes('git')) return

  const hit = RULES.find((rule) => rule.re.test(command))
  if (!hit) return

  // `ask` unless the rule names itself absolute, so a new rule added without a
  // verdict prompts rather than silently becoming unappealable.
  const decision = hit.decision === 'deny' ? 'deny' : 'ask'
  const closing =
    decision === 'deny'
      ? 'This one is absolute. Run it from a terminal outside this session if it is genuinely needed, because the `!` prefix goes through this same guard.'
      : 'Approve it only if you have checked the sentence above applies.'

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: `AGENTS.md restricts this (${hit.name}): ${hit.fix}. ${closing}`,
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

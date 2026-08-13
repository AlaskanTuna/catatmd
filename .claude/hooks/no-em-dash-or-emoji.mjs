#!/usr/bin/env node
// PreToolUse guard: refuse Write/Edit content that introduces an em dash or an emoji.
//
// House style for this repo is plain ASCII punctuation and no decorative glyphs.
// The guard blocks only characters this edit *adds*: an Edit whose old_string
// already carries the character is preserving existing text, not introducing it,
// so it passes. A Write has no prior text to compare against, so any occurrence
// in the new content is treated as introduced.
//
// Any internal failure exits 0 without a verdict. A broken guard must never be
// able to wedge a session.

import { readFileSync } from 'node:fs'

const RULES = [
  {
    name: 'em dash',
    re: /—/gu,
    fix: 'use a comma, colon, parentheses, or a full stop instead',
  },
  {
    name: 'emoji',
    re: /\p{Extended_Pictographic}|️/gu,
    fix: 'remove it',
  },
]

const count = (text, re) => (text.match(re) ?? []).length

const lineOf = (text, re) => {
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text)
  return m ? { char: m[0], line: text.slice(0, m.index).split('\n').length } : null
}

const main = () => {
  const payload = JSON.parse(readFileSync(0, 'utf8'))
  const input = payload?.tool_input ?? {}

  // Each pair is [new text, text it replaces]. Write has nothing to replace.
  const pairs = []
  if (typeof input.content === 'string') pairs.push([input.content, ''])
  if (typeof input.new_string === 'string') {
    pairs.push([input.new_string, typeof input.old_string === 'string' ? input.old_string : ''])
  }
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (typeof e?.new_string === 'string') {
        pairs.push([e.new_string, typeof e.old_string === 'string' ? e.old_string : ''])
      }
    }
  }

  const found = []
  for (const rule of RULES) {
    for (const [next, prev] of pairs) {
      if (count(next, rule.re) <= count(prev, rule.re)) continue
      const at = lineOf(next, rule.re)
      found.push(
        `${rule.name} ${JSON.stringify(at?.char ?? '')} (line ${at?.line ?? '?'} of the new content), ${rule.fix}`,
      )
      break
    }
  }

  if (!found.length) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Project house style forbids this: ${found.join('; ')}. Rewrite the content and try again.`,
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

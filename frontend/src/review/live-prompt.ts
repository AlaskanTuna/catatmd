import type { InformationGap, RedFlag } from '@shared/types'
import type { LivePanes } from '../audio/live/use-live-panes.js'

/**
 * What the live capture surface should say right now (#278).
 *
 * Pure, so the ordering that decides what a doctor reads mid-consultation is
 * testable without rendering anything. Nothing here filters, suppresses or
 * deduplicates a red flag: it partitions and orders, and `outstanding` always
 * carries the full list so a count is never a lie.
 */

export const SEVERITY_ORDER = { emergency: 0, urgent: 1, advisory: 2 } as const

/**
 * Ordering only, which is the whole of what `priority` means.
 *
 * The checklist that produces gaps documents `priority` as a volume and
 * ordering signal carrying no safety meaning on its own, so this sorts the list
 * and nothing more: nothing is filtered, no count changes, and no copy anywhere
 * calls a `high` gap urgent. Without it the few shown were whichever sat first
 * in the checklist source file, which is an ordering the reader cannot
 * interpret.
 */
export const GAP_PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

/**
 * Three prompts, and the cap is the design rather than a layout convenience.
 *
 * One guest consultation produces twenty-seven gaps. A panel holding
 * twenty-seven scrolls exactly like the rail holding twenty-seven did, so
 * moving the list into a card fixes nothing unless the card also chooses. Three
 * is what fits a glance; the rest stay one press away and are never dropped
 * from `outstanding`.
 */
export const PROMPT_LIMIT = 3

/**
 * The red-flag section's claim, as a closed set rather than a boolean.
 *
 * `clear` is a clinical assertion and is deliberately unreachable unless a
 * check actually ran and returned. `use-live-panes.ts` separates `flagsChecked`
 * from `hasContent` for exactly this, and names `flagsStalled` the one state
 * the pane must never hide.
 */
export type FlagState =
  /** `worst` is the head of `flags`, carried so the non-empty case is a type
   *  rather than an assumption the reader has to re-derive. */
  | { kind: 'flags'; worst: RedFlag; flags: readonly RedFlag[] }
  | { kind: 'stalled' }
  | { kind: 'unchecked' }
  | { kind: 'clear' }

export type PanelModel = {
  flags: FlagState
  /** At most `PROMPT_LIMIT`, already ordered. What the doctor reads. */
  ask: readonly InformationGap[]
  /** Every gap still outstanding, ordered. Drives the count and the full list. */
  outstanding: readonly InformationGap[]
}

/** Prompts the doctor has acted on, held by the caller and dead with the tab. */
export type Dismissed = {
  /** Asked out loud. Leaves the rotation; the next analysis cycle confirms it. */
  asked: readonly string[]
  /** Not now. Goes to the back, so it can resurface rather than vanish. */
  skipped: readonly string[]
}

export function selectPrompts(panes: LivePanes, dismissed: Dismissed): PanelModel {
  const flags = [...panes.redFlags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )

  /*
   * A stalled or not-yet-run check may not claim an absence, but it may never
   * hide a hit either. Flags present therefore win over both, matching the
   * order the rail already uses: `unearnedAbsence` is only consulted when the
   * list is empty.
   */
  const [worst] = flags
  const flagState: FlagState =
    worst !== undefined
      ? { kind: 'flags', worst, flags }
      : panes.flagsStalled
        ? { kind: 'stalled' }
        : panes.flagsChecked
          ? { kind: 'clear' }
          : { kind: 'unchecked' }

  const outstanding = [...panes.gaps].sort(
    (a, b) => GAP_PRIORITY_ORDER[a.priority] - GAP_PRIORITY_ORDER[b.priority],
  )

  /*
   * Asked leaves the rotation, skipped goes to the back. Both stay in
   * `outstanding`, because the doctor's saying it out loud is not the same as
   * the record establishing it, and a count that drops on a click would be
   * asserting something no analysis cycle has confirmed.
   */
  const rotating = outstanding.filter((gap) => !dismissed.asked.includes(gap.id))
  const ask = [
    ...rotating.filter((gap) => !dismissed.skipped.includes(gap.id)),
    ...rotating.filter((gap) => dismissed.skipped.includes(gap.id)),
  ].slice(0, PROMPT_LIMIT)

  return { flags: flagState, ask, outstanding }
}

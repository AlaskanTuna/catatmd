import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { type CopilotProposal, CopilotProposalSchema, type CopilotTurn } from '@shared/types'
import {
  CLICK_INSTRUCTION,
  hasPhantomClickInstruction,
} from '../backend/src/copilot/phantom-click.js'

/**
 * Measures how often CatatAI answers an edit request with a proposal card
 * rather than with prose (GitHub issue #185).
 *
 * **This is a measurement, not a test, and must never become one.** It spends a
 * real LLM call per turn and its results move with the provider. `bun run test`
 * stays deterministic and free precisely because this lives outside it. The
 * behaviour it measures is invisible to the suite by construction: every unit
 * test stubs the provider, so no stub can tell you whether the real model
 * reaches for a tool when a doctor phrases a request the way doctors do.
 *
 * **Both directions are measured, because only one of them is a bug.** Forcing
 * a tool call on every turn would raise the headline number and ruin the
 * product: a copilot that proposes an edit when the doctor asked a question is
 * worse than one that occasionally declines to. So the run reports the tool
 * rate on requests that *should* propose alongside the unsolicited rate on
 * questions that should *not*, and a prompt change is only an improvement if
 * the first rises while the second does not. A third arm of bare statements is
 * reported without a target, because it is where a careless fix does its damage
 * and neither answer there is clearly right.
 *
 * It drives `POST /api/consultations/:id/copilot` over HTTP rather than
 * importing `runCopilotTurn`, for the reason `run.ts` gives: that route is the
 * one a doctor's panel calls, so there is no second copy of the pipeline here
 * to drift from the first.
 *
 * Usage, against a consultation that already exists so the run creates no rows:
 *
 *   EVAL_API_URL=https://catatmd.vercel.app \
 *   EVAL_ORIGIN=https://catatmd.vercel.app \
 *   EVAL_CONSULTATION_ID=<an unapproved consultation on the guest account> \
 *   EVAL_LABEL=before \
 *   bunx tsx copilot-proposals.ts
 *
 * Every turn is written to `reports/copilot-proposals-<EVAL_LABEL>.json`, so a
 * later correction to the phantom-click pattern is a rescan of that file rather
 * than another 90 LLM calls. The run is resumable from that transcript, and
 * `EVAL_MAX_TURNS` caps one invocation, so a full run can be walked forward in
 * chunks when whatever is running it will not let a process live long enough:
 *
 *   EVAL_LABEL=before EVAL_MAX_TURNS=20 bunx tsx copilot-proposals.ts   # repeat
 */

const API_URL = process.env.EVAL_API_URL ?? 'http://localhost:3001'
const ORIGIN = process.env.EVAL_ORIGIN ?? 'http://localhost:5173'
const CONSULTATION_ID = process.env.EVAL_CONSULTATION_ID ?? ''
const REPS = Number(process.env.EVAL_REPS ?? '3')

/** Names the saved transcript, so a before-run and an after-run sit side by side. */
const LABEL = process.env.EVAL_LABEL ?? 'run'

/** Ceiling on one turn. See the note in `runTurn`. */
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TURN_TIMEOUT_MS ?? '120000')

/**
 * Edit requests in the register a doctor actually uses mid-review: an
 * imperative about the record, with no mention of tools, proposals or sections
 * by their schema name. The issue's reproduction is that the tool fires
 * reliably only when the request names the mechanism ("propose that as an edit
 * to the plan section"), so no prompt here is allowed to name it.
 */
const EDIT_REQUESTS = [
  'add a safety net to the plan',
  'the plan should tell her when to come back',
  'put the fever reading in the objective',
  'the assessment does not mention the tonsillar swelling, add it',
  'note that I dispensed the medicine in the plan',
  'the plan needs the MC duration spelled out',
  'add that she should return if she cannot swallow',
  'the objective should say the throat was red',
  'mention the three day history in the subjective',
  'add review in three days to the plan',
  'tighten the subjective, it is too wordy',
  'the plan is missing what to do if the fever comes back',
]

/**
 * Questions that must NOT produce a card. A copilot that proposes here is
 * editing the record because it was asked to read it, which is the regression
 * that a naive fix to the rate above would introduce.
 *
 * Held at parity with the edit arm on purpose. Before a prompt change these
 * guard a failure that is not happening; after one that adds a positive "call
 * the tool" trigger they guard the failure that change actively induces, so the
 * arm carrying the risk must not be the thinner one. The second six are
 * deliberately near misses: same clinical subject matter as the edit requests
 * above, same sections named, but phrased to ask what the record contains
 * rather than to change it.
 */
const CONTROL_REQUESTS = [
  'what did the patient say about their symptoms?',
  'what is still missing before I can sign this off?',
  'what guidance supports the current plan?',
  'is the assessment consistent with the transcript?',
  'what would another GP question about this note?',
  'summarise what this consultation established',
  'does the plan say when she should come back?',
  'is the MC duration written down anywhere in the note?',
  'does the objective record the throat findings?',
  'is the three day history captured in the subjective?',
  'which parts of the note does the guidance actually support?',
  'is anything in the subjective repeated?',
]

/**
 * Bare statements of clinical fact, which are neither of the above.
 *
 * **Watched, not scored, because the correct behaviour is genuinely unsettled.**
 * A doctor who says "she is allergic to penicillin" mid-review may be giving
 * context or may be dictating; a human reading the transcript could not tell you
 * which either. So this arm has no target and nothing here counts for or against
 * a fix.
 *
 * It exists because it is where a careless fix does its damage. The cheap way to
 * raise the tool-call rate is to teach the model that any sentence about the
 * record is a request to change it, and that lesson lands here first: these
 * become unsolicited edits while the question arm above stays clean and reports
 * no regression at all. What matters is the size of the move between two runs,
 * not the level. A jump from near zero to near everything means the fix stopped
 * distinguishing a request from a remark.
 */
const STATEMENTS = [
  'the patient also mentioned she is pregnant',
  'she is allergic to penicillin',
  'i examined the chest and it was clear',
  'her temperature was 38.2 when the nurse checked',
  'she has been taking paracetamol at home',
  'this is her second visit for the same problem',
]

interface TurnResult {
  prompt: string
  kind: 'edit' | 'control' | 'statement'
  proposals: CopilotProposal[]
  tools: string[]
  text: string
  error?: string
}

async function signIn(): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  })
  if (!response.ok) {
    throw new Error(`guest sign-in failed: ${response.status} ${await response.text()}`)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length === 0) throw new Error('guest sign-in returned no session cookie')
  return cookies.map((c) => c.split(';')[0]).join('; ')
}

/** Reads the `data:` frames the copilot route writes and collects one turn. */
async function runTurn(
  prompt: string,
  kind: TurnResult['kind'],
  cookie: string,
  history: CopilotTurn[],
): Promise<TurnResult> {
  const base: TurnResult = { prompt, kind, proposals: [], tools: [], text: '' }

  /*
   * Bounded, because an unbounded turn stalls the whole run rather than just
   * itself. Observed on "her temperature was 38.2 when the nurse checked": one
   * turn held the stream open past ten minutes and the invocation recorded
   * nothing at all. A turn that cannot finish is data too, so it is recorded as
   * an error and excluded from the rates rather than blocking the arm behind it.
   */
  const response = await fetch(`${API_URL}/api/consultations/${CONSULTATION_ID}/copilot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ message: prompt, history }),
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  })

  if (!response.ok || !response.body) {
    return { ...base, error: `${response.status} ${(await response.text()).slice(0, 200)}` }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read().catch((cause) => {
      base.error = `stream aborted after ${TURN_TIMEOUT_MS}ms: ${String(cause)}`.slice(0, 200)
      return { value: undefined, done: true as const }
    })
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (buffer.includes('\n\n')) {
      const split = buffer.indexOf('\n\n')
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const line = frame.split('\n').find((entry) => entry.startsWith('data:'))
      if (!line) continue
      let event: unknown
      try {
        event = JSON.parse(line.slice(5).trim())
      } catch {
        continue
      }
      const e = event as { type?: string; text?: string; name?: string; message?: string }
      if (e.type === 'token' && typeof e.text === 'string') base.text += e.text
      if (e.type === 'tool' && typeof e.name === 'string') base.tools.push(e.name)
      if (e.type === 'proposal') {
        const parsed = CopilotProposalSchema.safeParse((event as { proposal?: unknown }).proposal)
        if (parsed.success) base.proposals.push(parsed.data)
      }
      if (e.type === 'error') base.error = e.message ?? 'stream error'
    }
  }

  return base
}

function rate(results: TurnResult[], predicate: (r: TurnResult) => boolean): string {
  const usable = results.filter((r) => !r.error)
  if (usable.length === 0) return 'n/a (0 usable turns)'
  const hits = usable.filter(predicate).length
  return `${hits}/${usable.length} (${Math.round((hits / usable.length) * 100)}%)`
}

async function main() {
  if (!CONSULTATION_ID) {
    throw new Error(
      'Set EVAL_CONSULTATION_ID to an unapproved consultation on the account this signs in as. ' +
        'This eval deliberately creates no consultation of its own: there is no deletion ' +
        'endpoint (#80), so a run that created rows could not clean up after itself.',
    )
  }

  const cookie = await signIn()

  const plan = [
    ...EDIT_REQUESTS.map((p) => ({ prompt: p, kind: 'edit' as const })),
    ...CONTROL_REQUESTS.map((p) => ({ prompt: p, kind: 'control' as const })),
    ...STATEMENTS.map((p) => ({ prompt: p, kind: 'statement' as const })),
  ]

  /*
   * The whole run flattened, so a turn is addressed by one index and resuming
   * is "start at `results.length`" rather than arithmetic over reps.
   */
  const schedule = Array.from({ length: REPS }, (_, i) => i + 1).flatMap((rep) =>
    plan.map((entry) => ({ ...entry, rep })),
  )

  /*
   * Every turn's text is kept, which is the difference between rescoring and
   * re-measuring. The phantom-click figure is only as good as the pattern that
   * scored it, and the first version of that pattern was wrong in both
   * directions, so a run measured under it could not be checked against the
   * correction: nothing but the counts had been written down. Detectors get
   * corrected. Only the counts being durable is the part that made that
   * expensive.
   *
   * Written after **every turn**, not at the end, for the same reason and one
   * more: a full run is roughly half an hour of real LLM calls, and every
   * attempt so far has been killed around the ten-minute mark by the harness
   * running it. An end-of-run write throws away everything a partial run
   * learned.
   */
  await mkdir(new URL('reports/', import.meta.url), { recursive: true })
  const transcriptPath = new URL(`reports/copilot-proposals-${LABEL}.json`, import.meta.url)

  /*
   * Resumable, which is what makes the previous paragraph useful rather than
   * merely consoling. A killed run leaves a transcript; the next invocation
   * picks up at the turn after the last one recorded. `EVAL_MAX_TURNS` caps how
   * many new turns one invocation attempts, so the run can be walked forward in
   * chunks that finish inside whatever time limit is killing it.
   *
   * The saved schedule is compared before resuming. Appending to a transcript
   * whose earlier turns answered different prompts would produce a rate over a
   * prompt set that never existed, which is worse than starting again.
   */
  const schedulePrompts = schedule.map((entry) => entry.prompt)
  let results: TurnResult[] = []
  if (existsSync(transcriptPath)) {
    const prior = JSON.parse(await readFile(transcriptPath, 'utf8'))
    const matches =
      prior.CONSULTATION_ID === CONSULTATION_ID &&
      JSON.stringify(prior.schedule) === JSON.stringify(schedulePrompts)
    if (matches) {
      results = prior.results
      console.log(`resuming: ${results.length} of ${schedule.length} turns already recorded`)
    } else {
      console.log('existing transcript is for a different run, starting again')
    }
  }

  const persist = () =>
    writeFile(
      transcriptPath,
      JSON.stringify({ CONSULTATION_ID, REPS, schedule: schedulePrompts, results }, null, 2),
    )

  const budget = Number(process.env.EVAL_MAX_TURNS ?? String(schedule.length))
  const stopAt = Math.min(schedule.length, results.length + budget)

  for (const { prompt, kind, rep } of schedule.slice(results.length, stopAt)) {
    // Serial, and each turn is a fresh conversation with empty history. The
    // route's limiter allows 30/min and a turn takes seconds, so serial
    // execution stays under it without sleeping; more importantly, a shared
    // history would let one turn's answer steer the next and the rate would
    // stop being per-prompt.
    const result = await runTurn(prompt, kind, cookie, [])
    results.push(result)
    await persist()
    const mark = result.error ? 'ERR' : result.proposals.length > 0 ? 'CARD' : 'prose'
    console.log(`  [rep ${rep}] ${mark.padEnd(5)} ${kind.padEnd(7)} ${prompt}`)
    if (result.error) console.log(`         error: ${result.error}`)
  }

  if (results.length < schedule.length) {
    console.log(
      `\nincomplete: ${results.length} of ${schedule.length} turns. ` +
        'Run again with the same EVAL_LABEL to continue. No rates are reported ' +
        'until the run finishes, because a partial run is not a rate.',
    )
    return
  }

  const edits = results.filter((r) => r.kind === 'edit')
  const controls = results.filter((r) => r.kind === 'control')
  const statements = results.filter((r) => r.kind === 'statement')

  console.log('\n=== issue #185 measurement ===')
  console.log(`consultation: ${CONSULTATION_ID}`)
  console.log(
    `reps: ${REPS}, turns: ${results.length}, errors: ${results.filter((r) => r.error).length}`,
  )
  console.log('')
  console.log(`tool-call rate on edit requests   ${rate(edits, (r) => r.proposals.length > 0)}`)
  console.log(`   (higher is better)`)
  console.log(`unsolicited proposals on questions ${rate(controls, (r) => r.proposals.length > 0)}`)
  console.log(`   (lower is better; a fix that raises this is a regression)`)
  console.log(
    `proposals on bare statements       ${rate(statements, (r) => r.proposals.length > 0)}`,
  )
  console.log(`   (watched, not scored: compare the move between runs, not the level)`)
  console.log(
    `phantom click instructions         ${rate(results, (r) => hasPhantomClickInstruction(r.text, r.proposals.length))}`,
  )
  console.log(`   (must be 0: telling the doctor to click a card that does not exist)`)

  const phantoms = results.filter(
    (r) => !r.error && hasPhantomClickInstruction(r.text, r.proposals.length),
  )
  if (phantoms.length > 0) {
    console.log('\nphantom examples:')
    for (const p of phantoms.slice(0, 3)) {
      // A window around the match rather than the sentence, so the one pattern
      // in `phantom-click.ts` stays the only definition of what a match is.
      const at = p.text.search(CLICK_INSTRUCTION)
      const window = p.text
        .slice(Math.max(0, at - 80), at + 80)
        .replace(/\s+/g, ' ')
        .trim()
      console.log(`  "${p.prompt}" -> ...${window}...`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

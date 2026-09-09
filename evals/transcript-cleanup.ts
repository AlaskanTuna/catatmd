import { mkdir, writeFile } from 'node:fs/promises'
import type { Transcript } from '@shared/types'
import { evaluateRedFlags, proposeMishearCorrections } from '../backend/src/redflags/index.js'
import { REDFLAG_TRIGGERS } from '../backend/src/redflags/triggers.js'
import { proposeModelCorrections } from '../backend/src/transcript-cleanup/index.js'

/**
 * Answers the one question `docs/trd.md` §20.9 makes this feature conditional
 * on: **does the constrained model pass find correct corrections the measured
 * table does not?**
 *
 * §20.9, on the correction shape the owner chose: "The 11-entry table in
 * `redflags/mishears.ts` was measured on ILMU, covers exactly ILMU's error
 * family, and costs nothing. The model pass earns its place only if it finds
 * correct corrections the table does not. If it finds none, ship the
 * deterministic proposals alone and record the model pass as measured and
 * rejected."
 *
 * `TRANSCRIPT_CLEANUP` therefore defaults to `off`, and the number this harness
 * produces is what a decision to turn it on should rest on.
 *
 * **This is a measurement, not a test.** It spends real LLM calls and its
 * results move with the provider, so it lives outside `bun run test` for the
 * reason `evals/README.md` gives.
 *
 * **It imports the pass rather than driving the route**, unlike `run.ts` and
 * `copilot-proposals.ts`. Those exist to avoid a second copy of a pipeline;
 * here the route adds only an env gate and a concat, while reaching it over
 * HTTP would need a seeded consultation carrying per-token uncertainty, which
 * is a great deal of setup to measure a function of two arguments. What is
 * skipped is stated rather than hidden: this measures the pass and its policy,
 * not the route's merge.
 *
 * **Every fixture is synthetic**, per the §20.1 provenance rule. The errors are
 * modelled on the devoicing family §20.3 measured and on the one live capture
 * §20.10 records; none is a real consultation.
 *
 * Usage:
 *
 *   TRANSCRIPT_CLEANUP=on bunx tsx transcript-cleanup.ts
 *
 * Writes `reports/transcript-cleanup-<EVAL_LABEL>.json`.
 */

const LABEL = process.env.EVAL_LABEL ?? 'run'

/**
 * One synthetic consultation with a known error, and the correction a doctor
 * would accept.
 *
 * `uncertain` is supplied by hand because it is what a recogniser would have
 * reported, and this harness measures the correction layer rather than the
 * confidence layer. Marking only the genuinely wrong span is the optimistic
 * case for the model; `noise` cases mark a correct span instead, which is where
 * over-correction shows up.
 */
type Case = {
  id: string
  /** What the recogniser produced. */
  text: string
  /** The span the recogniser doubted, as `[start, end)` into `text`. */
  uncertain: [number, number]
  /**
   * The word a doctor should be offered, or `null` where the transcript is
   * already correct and the right answer is to propose nothing.
   */
  expect: { original: string; suggested: string } | null
  /** Whether the measured table can reach this pair at all. */
  inTable: boolean
}

const CASES: Case[] = [
  // In the table. The model adds nothing here; these measure that it does not
  // disagree with a pair that has evidence behind it.
  {
    id: 'table-teman',
    text: 'Saya teman dua hari sudah.',
    uncertain: [5, 10],
    expect: { original: 'teman', suggested: 'demam' },
    inTable: true,
  },
  {
    id: 'table-patut',
    text: 'Saya patut kering waktu malam.',
    uncertain: [5, 10],
    expect: { original: 'patut', suggested: 'batuk' },
    inTable: true,
  },

  // Outside the table, and the whole reason this layer was proposed. §20.7.1
  // measured "batuk" returning as "betul", a pair no confusable table can claim
  // without raising a cough flag on every sentence agreeing with the doctor.
  {
    id: 'beyond-betul',
    text: 'Saya betul sudah tiga hari, siang dan malam.',
    uncertain: [5, 10],
    expect: { original: 'betul', suggested: 'batuk' },
    inTable: false,
  },
  {
    id: 'beyond-selesai',
    text: 'Hidung saya selesai sejak semalam.',
    uncertain: [11, 18],
    expect: { original: 'selesai', suggested: 'selesema' },
    inTable: false,
  },
  {
    id: 'beyond-kelapa',
    text: 'Sakit kelapa teruk sejak pagi tadi.',
    uncertain: [6, 12],
    expect: { original: 'kelapa', suggested: 'kepala' },
    inTable: false,
  },

  // Over-correction probes. The transcript is already right, and the only
  // correct behaviour is to propose nothing. arXiv 2407.21414 measured
  // unconstrained correction degrading a transcript in exactly this regime.
  {
    id: 'noise-negation',
    text: 'Tiada sakit dada dan tiada sesak nafas.',
    uncertain: [0, 5],
    expect: null,
    inTable: false,
  },
  {
    id: 'noise-codeswitch',
    text: 'Ada check temperature dekat rumah tak?',
    uncertain: [4, 9],
    expect: null,
    inTable: false,
  },
  {
    id: 'noise-correct',
    text: 'Demam tu tinggi tak, ada ukur suhu?',
    uncertain: [0, 5],
    expect: null,
    inTable: false,
  },
]

const asTranscript = (probe: Case): Transcript => ({
  source: 'asr_live',
  turns: [
    {
      speaker: 'patient',
      text: probe.text,
      uncertain: [{ start: probe.uncertain[0], end: probe.uncertain[1] }],
    },
  ],
})

async function main() {
  if (process.env.TRANSCRIPT_CLEANUP !== 'on') {
    console.warn('TRANSCRIPT_CLEANUP is not "on". The pass will still run: this harness calls it')
    console.warn('directly rather than through the route, and the flag only gates the route.')
  }

  const results = []

  for (const probe of CASES) {
    const transcript = asTranscript(probe)
    const ruleFlags = evaluateRedFlags(transcript, REDFLAG_TRIGGERS)
    const table = proposeMishearCorrections(transcript)
    const model = await proposeModelCorrections(transcript, ruleFlags)

    const matches = (p: { original: string; suggested: string }) =>
      probe.expect !== null &&
      p.original === probe.expect.original &&
      p.suggested === probe.expect.suggested

    results.push({
      id: probe.id,
      inTable: probe.inTable,
      wanted: probe.expect,
      status: model.status,
      tableFound: table.some(matches),
      modelFound: model.proposals.some(matches),
      modelProposed: model.proposals.map((p) => ({
        original: p.original,
        suggested: p.suggested,
      })),
      dropped: model.dropped,
    })

    console.log(
      `${probe.id.padEnd(20)} table=${results.at(-1)?.tableFound ? 'y' : 'n'} ` +
        `model=${results.at(-1)?.modelFound ? 'y' : 'n'} ` +
        `proposed=${model.proposals.length} dropped=${model.dropped}`,
    )
  }

  /*
   * The headline number, and the only one §20.9's bar actually asks for: cases
   * the table cannot reach where the model proposed the correction a doctor
   * wanted. Everything else here is context for reading it.
   */
  const beyond = results.filter((r) => !r.inTable && r.wanted !== null)
  const earned = beyond.filter((r) => r.modelFound)

  const noise = results.filter((r) => r.wanted === null)
  const overCorrected = noise.filter((r) => r.modelProposed.length > 0)

  console.log('')
  console.log(`Corrections the table cannot reach: ${earned.length} of ${beyond.length} found`)
  console.log(
    `Over-corrections on already-correct text: ${overCorrected.length} of ${noise.length}`,
  )
  console.log('')
  console.log('§20.9: the pass earns its place only if the first number is above zero,')
  console.log('and it stops earning it as the second one rises.')

  await mkdir(new URL('reports/', import.meta.url), { recursive: true })
  const path = new URL(`reports/transcript-cleanup-${LABEL}.json`, import.meta.url)
  await writeFile(
    path,
    JSON.stringify({ label: LABEL, ranAt: new Date().toISOString(), results }, null, 2),
  )
  console.log(`\nWrote ${path.pathname}`)
}

await main()

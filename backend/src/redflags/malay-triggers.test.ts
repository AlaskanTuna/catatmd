import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

/**
 * GitHub issue #153. The matchers were English-only, so a Malay consultation
 * silently missed emergency-severity triggers, and the Malay negators shipped
 * in the machinery could suppress an English hit but never produce one:
 * "Tak apa, chest pain sikit je" muted the urgent chest-pain flag because
 * "tak apa" (never mind) sat in the trailing-negator window.
 *
 * Two things are pinned here. A completeness ratchet: every trigger id must
 * carry at least one Malay-only firing case, so a future trigger cannot ship
 * English-only. And the negation case table: idioms, uncertainty, and the
 * question particle must fail open, while genuine Malay denials still
 * suppress. Zero tolerance for false negatives outranks precision throughout.
 */

const transcript = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'fixture',
  turns,
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, ALL_REDFLAG_TRIGGERS)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

const patient = (text: string): Transcript => transcript([{ speaker: 'patient', text }])

/** One Malay-only firing case per trigger id, keyed by the id it must raise. */
const MALAY_TRIGGER_FIXTURES: Record<string, string> = {
  haemoptysis: 'Batuk berdarah sejak pagi tadi.',
  'significant-dyspnoea': 'Sesak nafas bila naik tangga.',
  'chest-pain': 'Sakit dada bila batuk kuat.',
  'stridor-airway-compromise': 'Nafas berbunyi bila tidur malam.',
  'swallowing-oral-intake': 'Tak boleh telan langsung sejak semalam.',
  'vital-signs-concern': 'Demam tak turun-turun dah tiga hari.',
  'uti-systemic-features': 'Demam dan menggigil sejak semalam.',
  'uti-flank-or-back-pain': 'Sakit pinggang sebelah kanan.',
  'uti-systemic-deterioration': 'Saya rasa nak pengsan tadi pagi.',
  'uti-pregnancy-mentioned': 'Saya mengandung empat bulan.',
  'uti-unable-to-pass-urine': 'Dah dua hari kencing tak keluar.',
  'uti-potentially-complicating-context': 'Saya ada kencing manis.',
}

describe('every trigger has Malay coverage (issue #153)', () => {
  it('the Malay case table covers exactly the trigger list, so a new trigger cannot ship English-only', () => {
    expect(Object.keys(MALAY_TRIGGER_FIXTURES).sort()).toEqual(
      ALL_REDFLAG_TRIGGERS.map((t) => t.id).sort(),
    )
  })

  it.each(Object.entries(MALAY_TRIGGER_FIXTURES))('%s fires on a Malay-only turn', (id, text) => {
    expect(ruleIds(patient(text))).toContain(id)
  })

  it.each([
    ['haemoptysis', 'Batuk sampai berdarah semalam.'],
    ['haemoptysis', 'Ludah berdarah pagi tadi.'],
    ['chest-pain', 'Sakit dekat dada bila tarik nafas dalam.'],
    ['chest-pain', 'Dada terasa sakit sikit.'],
    ['significant-dyspnoea', 'Rasa sesak bila baring malam.'],
    ['swallowing-oral-intake', 'Makan pun tak boleh dah dua hari.'],
    ['vital-signs-concern', 'Nadi laju sangat tadi.'],
    ['vital-signs-concern', 'Suhu badan tinggi sangat malam tadi.'],
    ['uti-potentially-complicating-context', 'Pesakit laki-laki, umur empat puluh.'],
  ])('%s also fires on the everyday variant "%s"', (id, text) => {
    expect(ruleIds(patient(text))).toContain(id)
  })
})

describe('Malay idioms, uncertainty, and question particles fail open', () => {
  it('fires through the idiom "tak apa", the reported false negative', () => {
    expect(ruleIds(patient('Tak apa, chest pain sikit je.'))).toContain('chest-pain')
    expect(ruleIds(patient('Tak apa doktor, dada sakit sikit je.'))).toContain('chest-pain')
  })

  it('fires through the single-word idiom "takpe"', () => {
    expect(ruleIds(patient('Takpe, sakit dada sikit je.'))).toContain('chest-pain')
  })

  it('fires through uncertainty, because unknown is never negative (docs/prd.md §10)', () => {
    expect(ruleIds(patient('Tak tahu lah, kadang-kadang sakit dada.'))).toContain('chest-pain')
    expect(ruleIds(patient('Tak pasti, tapi dada rasa ketat.'))).toContain('chest-pain')
  })

  it('fires through a minimizer that precedes the disclosure', () => {
    expect(ruleIds(patient('Takde apa-apa, sakit dada sikit je.'))).toContain('chest-pain')
  })

  it('fires after "tapi" and "cuma", which end a denial\'s scope', () => {
    expect(ruleIds(patient('Tak ada demam, tapi batuk berdarah.'))).toContain('haemoptysis')
    expect(ruleIds(patient('Tiada demam, cuma sesak nafas sikit.'))).toContain(
      'significant-dyspnoea',
    )
  })

  it('does not read the question particle as a denial', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Ada tak sakit dada?' },
          { speaker: 'patient', text: 'Ada, sejak pagi.' },
        ]),
      ),
    ).toContain('chest-pain')
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Sakit dada ke tak?' },
          { speaker: 'patient', text: 'Ya doktor.' },
        ]),
      ),
    ).toContain('chest-pain')
  })

  it('does not read an idiomatic or uncertain Malay reply as a leading denial', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'patient', text: 'Tak apa doktor.' },
        ]),
      ),
    ).toContain('chest-pain')
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Any chest pain?' },
          { speaker: 'patient', text: 'Tak tahu doktor.' },
        ]),
      ),
    ).toContain('chest-pain')
  })

  it('does not read the intensifier "bukan main" as a denial', () => {
    expect(ruleIds(patient('Bukan main sakit dada saya semalam.'))).toContain('chest-pain')
  })

  it('does not read a hedge as a denial, because "not very" confirms presence', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Ada sesak nafas?' },
          { speaker: 'patient', text: 'Tak berapa teruk, tapi ada la sikit.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('does not read the minimizer "tak ada apa-apa" or "takde apa-apa" as a denial', () => {
    expect(ruleIds(patient('Tak ada apa-apa, sakit dada sikit je.'))).toContain('chest-pain')
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Ada sesak nafas?' },
          { speaker: 'patient', text: 'Takde apa-apa yang teruk, tapi ada sikit.' },
        ]),
      ),
    ).toContain('significant-dyspnoea')
  })

  it('fires through a leading "Tak," when the span carries its own negator', () => {
    // Malay screening questions are normally negatively framed ("Boleh telan
    // tak?"), so a leading "Tak" is the standard affirmation of the finding.
    // A double negation is never a denial.
    expect(ruleIds(patient('Tak, kencing tak keluar dah dua hari.'))).toContain(
      'uti-unable-to-pass-urine',
    )
    expect(ruleIds(patient('Tak, tak boleh telan.'))).toContain('swallowing-oral-intake')
    expect(ruleIds(patient('Tak, saya tak boleh bernafas langsung.'))).toContain(
      'significant-dyspnoea',
    )
    expect(ruleIds(patient('Tak, demam tak kebah lagi.'))).toContain('vital-signs-concern')
  })

  it('fires on the "tarik nafas" collocation, the commonest Malay dyspnoea phrasing', () => {
    expect(ruleIds(patient('Susah nak tarik nafas, doktor.'))).toContain('significant-dyspnoea')
    expect(ruleIds(patient('Tak boleh tarik nafas langsung.'))).toContain('significant-dyspnoea')
  })

  it('fires when a negatively framed question is affirmed with a leading "Tak"', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Kencing tak keluar ke?' },
          { speaker: 'patient', text: 'Tak, memang tak keluar.' },
        ]),
      ),
    ).toContain('uti-unable-to-pass-urine')
  })

  it('over-fires on a genuinely denied negative question, the other documented accepted asymmetry', () => {
    // "Boleh je" denies the inability, but the span in the question carries
    // its own negator, so both context checks are skipped. A spurious flag
    // costs the doctor one dismissal; the suppressed alternative costs the
    // thing this engine exists to prevent.
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Tak boleh telan ke?' },
          { speaker: 'patient', text: 'Boleh je, takde masalah.' },
        ]),
      ),
    ).toContain('swallowing-oral-intake')
  })

  it('exercises the "ke" half of the question-particle lookbehind', () => {
    expect(ruleIds(patient('Betul ke tak sakit dada ni, doktor?'))).toContain('chest-pain')
  })

  it('over-fires on post-posed standalone negation, the documented accepted asymmetry', () => {
    // Negation is only looked for before the match, so "Sakit dada pun takde."
    // raises the flag. Failing open is the direction this engine must fail in;
    // this test documents the trade rather than discovering it later.
    expect(ruleIds(patient('Sakit dada pun takde.'))).toContain('chest-pain')
  })
})

describe('genuine Malay denials still suppress', () => {
  it('does not fire on a plain Malay denial', () => {
    expect(ruleIds(patient('Tiada sakit dada.'))).not.toContain('chest-pain')
    expect(ruleIds(patient('Tak ada sakit dada, batuk je.'))).not.toContain('chest-pain')
    expect(ruleIds(patient('Takde sesak nafas.'))).not.toContain('significant-dyspnoea')
    expect(ruleIds(patient('Tidak ada batuk berdarah.'))).not.toContain('haemoptysis')
  })

  it('does not fire when a Malay screening question is denied in Malay', () => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Ada sesak nafas?' },
          { speaker: 'patient', text: 'Takde.' },
        ]),
      ),
    ).not.toContain('significant-dyspnoea')
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: 'Batuk ada darah tak?' },
          { speaker: 'patient', text: 'Tak ada, doktor.' },
        ]),
      ),
    ).not.toContain('haemoptysis')
  })

  it('does not fire on chained genuine denials', () => {
    expect(ruleIds(patient('Tak ada demam, tak ada menggigil.'))).toEqual([])
  })
})

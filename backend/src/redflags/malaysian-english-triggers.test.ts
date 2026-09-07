import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

/**
 * Real ambient QA, 07/09/26. The patient said "this morning I was coughing out
 * blood", this engine raised nothing, and the model pass set Haemoptysis
 * Present on the patient card. The deterministic floor missed an
 * emergency-class symptom that the additive layer caught, which is the
 * inversion the engine exists to prevent: `.claude/skills/healthcare-cdss-patterns`
 * states zero tolerance for false negatives, and the rules are the reliable
 * half of the pair.
 *
 * Probing found one shape with three causes across four triggers, two of them
 * emergency severity:
 *
 * - **Past tense.** "coughed", "couldn't", "haven't passed". Every modal and
 *   verb was written in the present, and a patient describes hours that have
 *   already passed.
 * - **Particle choice.** "cough up blood" was covered and "cough out blood"
 *   was not.
 * - **A verb list applied unevenly** inside one trigger: "unable to" reached
 *   `swallow` but not `eat`; Malay "dapat" reached the pre-posed form but not
 *   the post-posed one.
 *
 * Two directions are pinned here, and both matter. Each new form fires, which
 * is the bug. And each new form stays silent on a denial, which is what stops
 * a widened matcher from firing on the doctor's own screening question
 * (the d61d5ad precedent, `question-context.test.ts`).
 */

const transcript = (turns: { speaker: 'doctor' | 'patient'; text: string }[]): Transcript => ({
  source: 'fixture',
  // Labels written by hand here, so suppression is available to the engine.
  labelsReviewed: true,
  turns,
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, ALL_REDFLAG_TRIGGERS)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)
    .sort()

const patient = (text: string): Transcript => transcript([{ speaker: 'patient', text }])

describe('the reported miss', () => {
  it('raises haemoptysis on the exact turn QA recorded', () => {
    expect(ruleIds(patient('This morning I was coughing out blood.'))).toContain('haemoptysis')
  })
})

describe('every phrasing the 07/09/26 probe found missing now fires', () => {
  it.each([
    // haemoptysis: particle, then tense, then a verb with no entry at all.
    ['haemoptysis', 'I cough out blood sometimes.'],
    ['haemoptysis', 'I coughed out blood last night.'],
    ['haemoptysis', 'I coughed up blood last night.'],
    ['haemoptysis', 'I have been spitting up blood.'],
    ['haemoptysis', 'There is blood when I cough.'],
    // The Malay counterpart of that last one names the blood before the cough.
    ['haemoptysis', 'Keluar darah bila batuk.'],
    ['haemoptysis', 'Ada darah bila batuk sejak semalam.'],
    ['haemoptysis', 'Darah keluar masa batuk pagi tadi.'],

    // significant-dyspnoea, EMERGENCY.
    ['significant-dyspnoea', "I couldn't breathe properly."],
    ['significant-dyspnoea', 'I could not breathe last night.'],
    ['significant-dyspnoea', 'I have difficulty in breathing.'],
    ['significant-dyspnoea', 'I have trouble breathing when I lie down.'],
    ['significant-dyspnoea', 'It is hard to breathe.'],
    ['significant-dyspnoea', 'It was difficult to breathe this morning.'],

    // swallowing-oral-intake.
    ['swallowing-oral-intake', "I couldn't swallow since yesterday."],
    ['swallowing-oral-intake', 'I am unable to eat.'],
    ['swallowing-oral-intake', 'I am unable to drink.'],
    ['swallowing-oral-intake', "I can't eat anything."],
    ['swallowing-oral-intake', "I can't drink anything."],
    ['swallowing-oral-intake', 'Makan pun tak dapat dah dua hari.'],
    ['swallowing-oral-intake', 'Minum pun tak dapat.'],

    // uti-unable-to-pass-urine, EMERGENCY.
    ['uti-unable-to-pass-urine', "I couldn't pass urine since last night."],
    ['uti-unable-to-pass-urine', "I haven't passed urine since morning."],
    ['uti-unable-to-pass-urine', 'I have not passed urine all day.'],
    ['uti-unable-to-pass-urine', 'Kencing pun tak dapat.'],
    ['uti-unable-to-pass-urine', 'Kencing pun tak keluar dah dua hari.'],
  ])('%s fires on "%s"', (id, text) => {
    expect(ruleIds(patient(text))).toContain(id)
  })
})

describe('nothing that already fired stops firing', () => {
  /**
   * The append-only constraint, made executable. Every form below was covered
   * before the new patterns were added, and a widened pattern rather than an
   * appended one is the change that would silently drop one: `findSpan` gives
   * each pattern a single `exec` per turn, so a widened alternation whose
   * leftmost match lands on a negated mention spends the attempt a genuine
   * mention later in the same turn needs.
   */
  it.each([
    ['haemoptysis', 'I am coughing up blood.'],
    ['haemoptysis', 'Blood in my sputum this morning.'],
    ['haemoptysis', 'Batuk berdarah sejak pagi tadi.'],
    ['significant-dyspnoea', "I can't breathe."],
    ['significant-dyspnoea', 'Difficulty breathing since last night.'],
    ['significant-dyspnoea', 'Sesak nafas bila naik tangga.'],
    ['swallowing-oral-intake', 'I cannot swallow.'],
    ['swallowing-oral-intake', 'Tak boleh telan langsung.'],
    ['swallowing-oral-intake', 'Makan pun tak boleh.'],
    ['uti-unable-to-pass-urine', "I can't pass urine."],
    ['uti-unable-to-pass-urine', 'Kencing tak keluar dah dua hari.'],
    ['uti-unable-to-pass-urine', 'Kencing pun tak boleh.'],
  ])('%s still fires on "%s"', (id, text) => {
    expect(ruleIds(patient(text))).toContain(id)
  })
})

describe('the new forms stay silent on a denial', () => {
  /**
   * Over-firing is the direction this engine fails in, and it is not free.
   * These are the cases where a wider matcher would start raising a flag on a
   * patient saying the symptom is absent.
   */
  it.each([
    ['haemoptysis', 'There is no blood when I cough.'],
    ['haemoptysis', 'I am not coughing out blood.'],
    ['haemoptysis', 'No spitting up blood.'],
    ['significant-dyspnoea', 'I have no trouble breathing.'],
    ['significant-dyspnoea', 'It is not hard to breathe.'],
    ['significant-dyspnoea', 'No difficulty in breathing.'],
  ])('%s does not fire on a patient denial "%s"', (id, text) => {
    expect(ruleIds(patient(text))).not.toContain(id)
  })

  /**
   * The two exclusions that are clinical rather than grammatical, both
   * measured firing before they were bounded.
   *
   * A blocked nose is the commonest presenting complaint in the population
   * `adult-acute-urti` covers, so "hard to breathe through my nose" must not
   * raise an emergency flag. `triggers.ts` already refuses bare "sesak" for
   * exactly this reason ("hidung sesak"), and the English side now reads the
   * same.
   *
   * "Pass motion" is everyday Malaysian English for a bowel movement, so a
   * bare "pass" would put the emergency retention trigger on constipation.
   */
  it.each([
    ['significant-dyspnoea', 'It is hard to breathe through my nose, very blocked.'],
    ['significant-dyspnoea', 'I have trouble breathing through the nose when it is blocked.'],
    ['significant-dyspnoea', 'Difficulty in breathing through my nose since the cold started.'],
    ['uti-unable-to-pass-urine', "I haven't passed motion for two days."],
    ['uti-unable-to-pass-urine', "I couldn't pass motion since yesterday."],
  ])('%s does not fire on the other-organ reading "%s"', (id, text) => {
    expect(ruleIds(patient(text))).not.toContain(id)
  })

  it.each([
    ['haemoptysis', 'Any coughing out blood?', 'No, none of that.'],
    ['haemoptysis', 'Have you coughed up blood?', 'No.'],
    ['significant-dyspnoea', 'Any trouble breathing?', 'No, breathing is fine.'],
    ['significant-dyspnoea', 'Is it hard to breathe?', 'No, not at all.'],
    ['swallowing-oral-intake', 'Are you unable to eat?', 'No, I am eating fine.'],
  ])('%s does not fire when the doctor screens with "%s" and the patient denies', (id, q, a) => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: q },
          { speaker: 'patient', text: a },
        ]),
      ),
    ).not.toContain(id)
  })
})

describe('a leading denial does not suppress the inability that follows it', () => {
  /**
   * Why `couldn'?t` and `haven'?t` joined `SPAN_CARRIES_NEGATOR`. A Malaysian
   * patient answers a positively framed question with a denial of the ability
   * and then names the inability: "No, I couldn't breathe" denies "could you
   * breathe", it does not deny breathlessness. Reading the leading "No" as a
   * denial of the span suppresses an emergency trigger, which is the failure
   * this engine exists to prevent.
   *
   * "cannot" and "can't" already took this route; the past-tense contractions
   * did not, and "could not breathe" needed no entry because it carries a
   * bare "not" already.
   */
  it.each([
    ['significant-dyspnoea', 'Could you breathe okay?', "No, I couldn't breathe."],
    ['uti-unable-to-pass-urine', 'Have you passed urine today?', "No, I haven't passed urine."],
  ])('%s fires on "%s" answered "%s"', (id, q, a) => {
    expect(
      ruleIds(
        transcript([
          { speaker: 'doctor', text: q },
          { speaker: 'patient', text: a },
        ]),
      ),
    ).toContain(id)
  })
})

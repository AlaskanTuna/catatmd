import type { Transcript } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'
import type { RedFlagTrigger } from './types.js'

/**
 * docs/trd.md §10 "What Stays Undecided": no clinician has validated this
 * list. It is sourced from the Malaysian corpus named in docs/trd.md §11
 * (MOH NAG 4th ed. 2024, Abdullah et al. 2024, Ooi et al. 2022) rather than
 * NICE, whose licence forbids AI use. Where those sources restate Centor /
 * McIsaac, this list expresses them in our own words per docs/trd.md §10.
 *
 * Bumped whenever a trigger is added, removed, or its matcher or severity
 * changes. Recorded with every analysis (docs/trd.md §15).
 */
export const RED_FLAG_LIST_VERSION: ClinicalArtefactVersion = {
  id: 'redflag-list-v4',
  effectiveDate: '2026-08-15',
}

const URTI_PROFILES: readonly ProfileId[] = ['adult-acute-urti']
const URTI_AND_UTI_PROFILES: readonly ProfileId[] = [
  'adult-acute-urti',
  'adult-acute-uncomplicated-uti',
]
const UTI_PROFILES: readonly ProfileId[] = ['adult-acute-uncomplicated-uti']

/**
 * Malay negators, minus constructions that mention rather than deny.
 * "tak apa"/"takpe" is the idiom "never mind"; "tak tahu"/"tak pasti" is
 * uncertainty, and unknown is never negative (docs/prd.md §10); "tak berapa"/
 * "tak banyak" is a hedge ("not very"), which confirms presence; "tak ada
 * apa-apa" is the minimizer that precedes a disclosure; a "tak" right after
 * "ada" or "ke" is the question particle ("ada tak sakit dada?"), not a
 * denial. "bukan" is deliberately absent: "bukan main sakit dada" is an
 * intensifier, and a negator that can read it as a denial is a false negative.
 * One accepted asymmetry: post-posed standalone negation ("Sakit dada pun
 * takde.") over-fires, because negation is only looked for before the match,
 * and failing open is the direction this engine must fail in.
 * The fragment carries no flag of its own; both hosts below add `i`.
 */
const MALAY_NEGATOR =
  /(?<!\b(?:ada|ke)\s)(?:tak(?!\s+(?:apa|pe|tahu|pasti|berapa|banyak|seberapa|ada\s+apa)\b)|tidak(?!\s+(?:apa|mengapa|tahu|pasti|berapa|banyak|seberapa|ada\s+apa)\b)|takde(?!\s+apa\b)|tiada(?!\s+apa\b))/

/**
 * A reply that opens by denying the thing just asked about. Deliberately narrow
 * (GitHub issue #70): it matches only an unambiguous leading negation, in
 * English and the Malay a Malaysian consultation actually uses, and anything it
 * is unsure of is not a denial. The Malay side comes solely from
 * MALAY_NEGATOR, so its idiom, uncertainty, hedge, and minimizer exclusions
 * apply here too: "Tak apa doktor.", "Tak tahu doktor.", "Tak berapa teruk,
 * tapi ada sikit.", and "Takde apa-apa yang teruk, tapi ada sikit." all fail
 * open, while "Takde.", "Tak ada.", and "Tiada." stay genuine denials.
 */
const LEADING_DENIAL = new RegExp(
  `^\\s*(?:no+|nope|none|nothing|negative|${MALAY_NEGATOR.source}|takda|belum)\\b`,
  'i',
)

/**
 * Whether a doctor turn asks rather than states. A screening question names the
 * symptom it is screening for, so the naive matcher fires on the question and
 * ignores the answer, which is what issue #70 reported.
 */
const isQuestion = (text: string): boolean => /\?\s*$/.test(text.trim())

/**
 * Does this turn's text count as asserting the symptom it mentions?
 *
 * Patient turns always do. A doctor's statement always does, so an observed
 * finding ("I can hear stridor") still fires. A doctor's *question* does only
 * when the patient's reply does not open with a denial.
 *
 * The default is to assert, which is the direction this engine must fail in.
 * Dropping every question instead would be the obvious fix and a worse one: a
 * patient answering "Yes, since this morning" to "Any chest pain?" never says
 * the words, so the question is the only place the symptom appears and
 * discarding it would lose the flag entirely.
 */
const asserts = (transcript: Transcript, index: number): boolean => {
  const turn = transcript.turns[index]
  if (turn === undefined || turn.speaker !== 'doctor' || !isQuestion(turn.text)) return true

  const reply = transcript.turns[index + 1]
  if (reply === undefined || reply.speaker !== 'patient') return true

  return !LEADING_DENIAL.test(reply.text)
}

/**
 * Words that end the scope of a preceding negation: "no fever but chest pain",
 * "tiada demam, cuma sesak nafas".
 */
const NEGATION_SCOPE_END = /\b(?:but|tapi|however|although|except|cuma|cuman)\b/i

/** An unambiguous negator sitting immediately before the matched span. */
const TRAILING_NEGATOR = new RegExp(
  `\\b(?:no|not|none|never|denies|denied|without|${MALAY_NEGATOR.source})\\b[^.!?;]{0,24}$`,
  'i',
)

/**
 * Is this match negated by the words immediately before it? Scoped tightly on
 * purpose: only the run of text since the last clause break is considered, and
 * a "but" ends the negation's reach, so "no fever but chest pain" still fires.
 *
 * This exists because a denial often repeats the phrase being denied. "No pain
 * in the chest" contains "pain in the chest", so suppressing the doctor's
 * question alone still left the patient's own denial matching (issue #70).
 */
const isNegated = (text: string, matchIndex: number): boolean => {
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex)
  const inScope = before.split(NEGATION_SCOPE_END).pop() ?? ''
  return TRAILING_NEGATOR.test(inScope)
}

/**
 * A span that carries its own negator asserts the inability it names:
 * "cannot swallow", "tak boleh telan", "kencing tak keluar". Around such a
 * span, negation words flip meaning rather than deny it. A negator before it
 * ("Tak, kencing tak keluar dah dua hari") is Malay's affirmative reply to a
 * negatively framed screening question, and a "Tak." reply to a question that
 * names the span ("Kencing tak keluar ke?") affirms the finding rather than
 * denying it, because Malay screening questions are normally negatively
 * framed. A double negation is never a denial in either language, so these
 * spans skip both the reply-denial check and the trailing-negator check. The
 * bypass is deliberately broader than Malay inability: English
 * negator-carrying spans ("not coming down", "not able to eat") and
 * absence-of-event spans ("period tak datang") take the same route, because
 * the polarity argument holds for all of them. The cost is accepted and
 * pinned by test: a genuinely denied negative question over-fires.
 * Over-firing is the direction this engine fails in.
 */
const SPAN_CARRIES_NEGATOR = /\b(?:no|not|cannot|tak|tidak|takde|tiada)\b|can'?t|won'?t/i

const findSpan = (transcript: Transcript, patterns: readonly RegExp[]): string | null => {
  for (const [index, turn] of transcript.turns.entries()) {
    for (const pattern of patterns) {
      const match = pattern.exec(turn.text)
      if (match === null) continue
      if (SPAN_CARRIES_NEGATOR.test(match[0])) return match[0]
      if (asserts(transcript, index) && !isNegated(turn.text, match.index)) return match[0]
    }
  }
  return null
}

const NAG_SCOPE_NOTE =
  'MOH National Antimicrobial Guideline (NAG) 4th ed. 2024, §C1/C3 (acute bronchitis / acute ' +
  'pharyngitis): the antimicrobial-decision algorithms there presuppose an uncomplicated URTI ' +
  'presentation; this finding sits outside that scope and needs clinical reassessment beyond ' +
  'the antibiotic decision.'

const DELPHI_AIRWAY_NOTE =
  'Abdullah et al. (2024), Malaysian sore-throat Delphi consensus, Infect Drug Resist: the ' +
  'McIsaac-scored antibiotic pathway that consensus establishes presupposes the absence of ' +
  'airway or swallowing compromise; this finding sits outside that pathway.'

export const REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  {
    id: 'haemoptysis',
    label: 'Haemoptysis reported — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /cough(?:ing)?\s+up\s+blood/i,
        /blood[- ]tinge?d?\s+(?:sputum|phlegm|mucus)/i,
        /blood\s+in\s+(?:the\s+|my\s+|his\s+|her\s+)?(?:sputum|phlegm|mucus|cough)/i,
        /\bha?emoptysis\b/i,
        /batuk(?:-batuk)?\s+(?:sampai\s+)?(?:ber)?darah/i,
        /batuk(?:-batuk)?\s+(?:sampai\s+)?(?:keluar|ada)\s+darah/i,
        /kahak\s+(?:ada\s+)?(?:ber)?darah/i,
        /darah\s+dalam\s+kahak/i,
        /ludah\s+(?:ber)?darah/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'significant-dyspnoea',
    label: 'Significant breathlessness reported — needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /can'?t\s+breathe/i,
        /cannot\s+breathe/i,
        /difficult(?:y)?\s+breathing/i,
        /short(?:ness)?\s+of\s+breath/i,
        /\bbreathless(?:ness)?\b/i,
        /struggling\s+to\s+breathe/i,
        /gasping\s+for\s+(?:air|breath)/i,
        // na[fp]as covers both the Malaysian (nafas) and Indonesian (napas)
        // spellings, which both occur in Malaysian speech-to-text output.
        // Bare "sesak" is deliberately excluded ("hidung sesak" is an ordinary
        // blocked nose in URTI); "rasa sesak" and an intensified "sesak" are
        // unambiguous and included.
        /sesak\s+na[fp]as/i,
        /rasa\s+sesak\b/i,
        /sesak\s+(?:sangat|teruk)\b/i,
        /\bsemput\b/i,
        /(?:susah|payah|sukar)\s+(?:nak\s+|untuk\s+)?(?:tarik\s+)?(?:ber)?na[fp]as/i,
        // The negator is part of the phrase, as in /can'?t\s+breathe/ above,
        // so isNegated cannot read it as a denial of itself.
        /(?:tak|tidak)\s+(?:boleh|dapat|larat)\s+(?:nak\s+)?(?:tarik\s+)?(?:ber)?na[fp]as/i,
        /na[fp]as\s+pendek/i,
        /\btercungap/i,
        /\btermengah/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'chest-pain',
    label: 'Chest pain reported — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /chest\s+pain/i,
        /pain\s+in\s+(?:my|the|his|her)\s+chest/i,
        /tight(?:ness)?\s+in\s+(?:my|the|his|her)\s+chest/i,
        /sakit\s+(?:kat\s+|di\s+|dekat\s+)?dada/i,
        /dada\s+(?:saya\s+|pun\s+)?(?:(?:te)?rasa\s+)?sakit/i,
        /dada\s+(?:(?:te)?rasa\s+)?(?:ketat|berat|sesak)/i,
        /sesak\s+dada/i,
        /nyeri\s+dada/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'stridor-airway-compromise',
    label: 'Possible airway compromise (stridor) — needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        // stridor and trismus stay English: they are clinical terms a
        // Malaysian doctor states in English.
        /\bstridor\b/i,
        /noisy\s+breathing/i,
        /\bdrooling\b/i,
        /\btrismus\b/i,
        /muffled\s+voice/i,
        /voice\s+sounds?\s+muffled/i,
        /na[fp]as\s+berbunyi/i,
        /berbunyi\s+(?:bila|masa|waktu|ketika)\s+(?:tarik\s+)?na[fp]as/i,
        /air\s+liur\s+(?:asyik\s+)?meleleh/i,
        /meleleh\s+air\s+liur/i,
      ]),
    clinicalSource: DELPHI_AIRWAY_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'swallowing-oral-intake',
    label: 'Unable to swallow or maintain oral intake — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /(?:can'?t|cannot)\s+swallow/i,
        /unable\s+to\s+swallow/i,
        /can'?t\s+(?:keep|hold)\s+(?:anything|fluids|food|water)\s+down/i,
        /not\s+(?:been\s+)?able\s+to\s+(?:eat|drink)/i,
        /refusing\s+to\s+(?:eat|drink)/i,
        /no\s+oral\s+intake/i,
        // "susah nak telan" is deliberately excluded: difficulty swallowing is
        // expected URTI odynophagia, and adding it would widen this trigger
        // from inability to difficulty, a clinical-scope change.
        /(?:tak|tidak)\s+(?:boleh|dapat|lalu)\s+(?:nak\s+)?telan/i,
        /(?:tak|tidak)\s+(?:boleh|dapat|lalu)\s+(?:nak\s+)?(?:makan|minum)/i,
        /(?:telan|makan|minum)\s+(?:pun\s+)?tak\s+(?:boleh|lalu)/i,
      ]),
    clinicalSource: DELPHI_AIRWAY_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    /**
     * No numeric vital-sign cutoff (SpO2 / RR / HR / BP) attributable to
     * docs/trd.md §11's corpus was located — NAG 2024, Abdullah et al. 2024,
     * and Ooi et al. 2022 do not publish one for this scope, and no clinician
     * is available to validate an invented number (docs/trd.md §10, Q7).
     * Rather than invent a threshold, this trigger matches the clinician's
     * own stated severity assessment of a vital sign in the transcript.
     */
    id: 'vital-signs-concern',
    label: 'Vital sign described as critically abnormal — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /oxygen\s+(?:level|saturation|sats?)\D{0,20}(?:low|dropping|falling|desaturat\w*)/i,
        /(?:temperature|fever)\D{0,20}(?:very\s+high|extremely\s+high|not\s+coming\s+down|won'?t\s+come\s+down)/i,
        /(?:heart\s+rate|pulse)\D{0,20}(?:very\s+fast|racing|dangerously\s+(?:high|fast))/i,
        /blood\s+pressure\D{0,20}(?:very\s+low|dropping|dangerously\s+low)/i,
        // Bare "berdebar" (palpitation) and bare "darah rendah" (a chronic
        // descriptor) are excluded: neither states the critical severity this
        // trigger exists to match.
        /demam\D{0,20}(?:tak|tidak)\s+(?:turun(?:-turun)?|kebah)/i,
        /demam\s+(?:sangat|terlalu)\s+(?:tinggi|teruk)/i,
        /demam\s+(?:tinggi|teruk)\s+sangat/i,
        /suhu(?:\s+badan)?\D{0,20}(?:sangat\s+tinggi|tinggi\s+sangat|terlalu\s+tinggi)/i,
        /oksigen\D{0,20}rendah/i,
        /(?:jantung|nadi)\D{0,20}(?:sangat\s+laju|laju\s+sangat)/i,
        /tekanan\s+darah\D{0,20}(?:sangat\s+rendah|rendah\s+sangat|jatuh)/i,
      ]),
    clinicalSource:
      'No Malaysian-sourced numeric vital-sign threshold found in the docs/trd.md §11 corpus ' +
      "(NAG 2024, Abdullah et al. 2024, Ooi et al. 2022); this trigger matches the clinician's " +
      'own stated severity assessment rather than an invented cutoff — see docs/trd.md §10 ' +
      '"What Stays Undecided".',
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_AND_UTI_PROFILES,
  },
]

const UTI_SCOPE_NOTE =
  'MOH National Antimicrobial Guideline (NAG) 4th ed. 2024, urinary tract infection guidance: ' +
  'this prototype surfaces a deliberately broad escalation prompt when the transcript describes ' +
  'a feature that can fall outside an uncomplicated adult primary-care presentation. No clinician ' +
  'has reviewed this trigger content.'

export const UTI_REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  {
    id: 'uti-systemic-features',
    label: 'Fever, chills, or rigors reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        // Bare /\bdemam\b/ mirrors the deliberate breadth of bare /\bfever\b/.
        /\bfever(?:ish)?\b/i,
        /\bchills?\b/i,
        /\brigors?\b/i,
        /\bshiver(?:ing)?\b/i,
        /\bdemam\b/i,
        /\bmenggigil\b/i,
        /seram\s+sejuk/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-flank-or-back-pain',
    label: 'Flank or back pain reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bflank\b/i,
        /\bloin\b/i,
        /\bkidney\s+pain\b/i,
        /(?:pain|ache)\s+(?:in\s+)?(?:my\s+)?(?:lower\s+)?back\b/i,
        /sakit\s+(?:kat\s+|di\s+|dekat\s+)?pinggang/i,
        /pinggang\s+(?:(?:te)?rasa\s+)?sakit/i,
        /sakit\s+(?:kat\s+|di\s+|dekat\s+)?belakang/i,
        /belakang\s+(?:(?:te)?rasa\s+)?sakit/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-systemic-deterioration',
    label: 'Possible systemic deterioration reported, needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bconfus(?:ed|ion)\b/i,
        /\bfaint(?:ed|ing)?\b/i,
        /\bvery\s+drowsy\b/i,
        /\bextremely\s+weak\b/i,
        /\bfeeling\s+very\s+unwell\b/i,
        // Bare "tak larat" is excluded as too broad (everyday tiredness); the
        // \b on "keliru" keeps "mengelirukan" (confusing) out.
        /\bpengsan\b/i,
        /\bpitam\b/i,
        /\bkeliru\b/i,
        /lemah\s+(?:sangat|teruk)/i,
        /sangat\s+lemah/i,
        /tak\s+larat\s+(?:nak\s+)?bangun/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-pregnancy-mentioned',
    label: 'Pregnancy or possible pregnancy mentioned, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bpregnan(?:t|cy)\b/i,
        /\bmissed\s+(?:my\s+)?period\b/i,
        /\btrying\s+for\s+(?:a\s+)?baby\b/i,
        // The \b on "mengandung" keeps "mengandungi" (contains) out.
        /\bmengandung\b/i,
        /\bhamil\b/i,
        /(?:period|haid)\s+(?:tak\s+datang|lambat|lewat)/i,
        /(?:tak\s+datang|lambat|lewat)\s+(?:period|haid)/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-unable-to-pass-urine',
    label: 'Unable to pass urine reported, needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /(?:can'?t|cannot|unable\s+to)\s+(?:pass|pee|urinate)/i,
        /\bnot\s+passing\s+(?:any\s+)?urine\b/i,
        /\bno\s+urine\s+(?:is\s+)?coming\s+out\b/i,
        // "susah nak kencing" is deliberately excluded: dysuria is an expected
        // uncomplicated-UTI symptom, not retention.
        /(?:tak|tidak)\s+(?:boleh|dapat)\s+(?:nak\s+)?(?:kencing|buang\s+air\s+kecil)/i,
        /(?:air\s+)?kencing\s+tak\s+keluar/i,
        /kencing\s+(?:pun\s+)?tak\s+(?:boleh|lepas)/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-potentially-complicating-context',
    label: 'Potentially complicating urinary context reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\b(?:urinary\s+)?catheter(?:ised|ized)?\b/i,
        /\bkidney\s+(?:disease|failure|transplant)\b/i,
        /\bsingle\s+kidney\b/i,
        /\bimmunosuppress(?:ed|ion)\b/i,
        /\bdiabetes?\b/i,
        /\bmale\b/i,
        // "sakit buah pinggang" is ambiguous between kidney disease and kidney
        // pain; firing this trigger either way is the safe direction. Bare
        // "buah pinggang" is excluded, and /\blelaki\b/ mirrors the deliberate
        // breadth of /\bmale\b/ exactly.
        /kencing\s+manis/i,
        /\bkateter\b/i,
        /(?:masalah|penyakit|sakit)\s+buah\s+pinggang/i,
        /buah\s+pinggang\s+(?:rosak|gagal|bermasalah)/i,
        /\b(?:lelaki|laki-laki)\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
]

export const ALL_REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  ...REDFLAG_TRIGGERS,
  ...UTI_REDFLAG_TRIGGERS,
]

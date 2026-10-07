/**
 * Malaysian name cues and a given-name deny-list.
 *
 * docs/trd.md §9: a gazetteer is the **only** measure available in this window
 * that raises name recall without a model, and the published evidence says an
 * ML NER would miss unmarked Malay names disproportionately anyway. It is a
 * second recall pass for names carrying no particle or honorific cue — not a
 * claim of completeness. docs/prd.md §12 states the recall limitation plainly.
 */

import { MEDICATION_LEXICON } from '../medications/lexicon.js'

/** Titles that precede a name. Malay, English and clinical. */
export const HONORIFICS = [
  'Mr',
  'Mrs',
  'Ms',
  'Miss',
  'Dr',
  'Prof',
  'Encik',
  'Cik',
  'Puan',
  'Tuan',
  'Datuk',
  'Dato',
  'Datin',
  'Tan Sri',
  'Haji',
  'Hajjah',
] as const

/**
 * Patronymic and filial particles. These sit *between* name parts, so a match
 * extends the span in both directions — `Ahmad bin Ismail` is one name, not two.
 */
export const PATRONYMICS = ['bin', 'binti', 'bt', 'bte', 'a/l', 'a/p', 'anak'] as const

/** Phrases after which the next capitalised run is a name. */
export const NAME_INTRODUCERS = [
  'my name is',
  'name is',
  "patient's name is",
  'patient name',
  'nama saya',
  'saya',
  'this is',
  'i am',
] as const

/**
 * Cues for a name said in Chinese or Tamil script (#418).
 *
 * `SCRIPT` leaves both scripts alone so the note can read Mandarin and Tamil
 * speech, so a name in either is found only where something says a name comes
 * next: a self-introduction, or a title. A Chinese name must also open on a
 * listed surname, because "我叫" is as often "I called" (我叫救护车, an
 * ambulance) as "my name is", and a surname is what tells the two apart.
 */
export const HAN_NAME_INTRODUCERS = [
  '我的名字是',
  '我的名字叫',
  '我嘅名係',
  '我個名叫',
  '我名叫',
  '我叫',
] as const

/** "My surname is", after which the surname, and sometimes the given name, follow. */
export const HAN_SURNAME_INTRODUCERS = ['我姓', '他姓', '她姓', '佢姓'] as const

/** Titles that follow a surname, as in 陈先生 or 林医生. */
export const HAN_TITLES = ['先生', '小姐', '女士', '太太', '医生', '醫生', '老师', '老師'] as const

/**
 * Common Chinese surnames in Malaysia, simplified and traditional. Several are
 * ordinary words too (黄 "yellow", 白 "white", 高 "tall"), which is why the list
 * is only ever read after a cue or directly before a title.
 */
export const HAN_SURNAMES =
  '陈陳林李黄黃张張王吴吳刘劉蔡杨楊郑鄭梁谢謝许許何郭罗羅黎胡曾邱丘叶葉周赖賴苏蘇洪朱孙孫马馬高徐钟鍾邓鄧冯馮彭潘卢盧温溫江方沈余傅宋萧蕭庄莊卓颜顏石施侯邝鄺麦麥伍姚汤湯简簡范魏廖骆駱欧歐戴唐袁董程韩韓曹夏于蒋蔣田杜姜崔谭譚陆陸汪任金邵贺賀龚龔熊孟秦薛雷尹段白毛甘尤柯翁游涂关關辜赵趙孔鲁魯倪史钱錢严嚴陶包华華祝邢龙龍万萬顾顧阮杭池宁寧'

/** Two-character surnames, read wherever a single-character one is. */
export const HAN_COMPOUND_SURNAMES = [
  '欧阳',
  '歐陽',
  '司徒',
  '上官',
  '诸葛',
  '諸葛',
  '司马',
  '司馬',
  '东方',
  '東方',
] as const

/**
 * Characters that, directly before a surname, make it part of an ordinary word
 * rather than a name: 谢谢医生 ("thank you, doctor"), 上周医生 ("last week the
 * doctor"), 关于医生 ("about the doctor"), 任何医生 ("any doctor").
 */
export const HAN_NOT_BEFORE_SURNAME = '谢謝多这這那下上每本其关關由对對至有任'

/** "My name is", in Tamil, written and spoken. */
export const TAMIL_NAME_INTRODUCERS = [
  'என்னுடைய பெயர்',
  'எனது பெயர்',
  'என் பெயர்',
  'என்னோட பேரு',
  'என் பேரு',
  'என் பேர்',
] as const

/** Mrs, Miss and Mr, written before the name. Longest first, as `திரு` opens `திருமதி`. */
export const TAMIL_TITLES = ['திருமதி', 'செல்வி', 'திரு'] as const

/**
 * Given names common in Malaysia across the three main communities, and among
 * its Pakistani and Bangladeshi patients. Deliberately a *given*-name list:
 * surnames and second elements are picked up by the adjacency rules, and a
 * longer list would trade precision for little recall.
 */
export const GIVEN_NAMES = new Set(
  [
    // Malay
    'ahmad',
    'muhammad',
    'mohd',
    'mohamad',
    'mohamed',
    'abdul',
    'abdullah',
    'ali',
    'ismail',
    'ibrahim',
    'hassan',
    'hussein',
    'osman',
    'razak',
    'rahim',
    'aziz',
    'farid',
    'faizal',
    'hakim',
    'iskandar',
    'khairul',
    'nazri',
    'rizal',
    'syafiq',
    'zainal',
    'zulkifli',
    'amir',
    'danial',
    'haziq',
    'irfan',
    'siti',
    'nur',
    'nurul',
    'aisyah',
    'fatimah',
    'hasnah',
    'khadijah',
    'maimunah',
    'noraini',
    'rohana',
    'salmah',
    'zainab',
    'zuraida',
    'aminah',
    'halimah',
    'sharifah',
    'wan',
    'nabila',
    'syafiqah',
    'aleeya',
    'balqis',
    // Chinese
    'tan',
    'lim',
    'lee',
    'wong',
    'chan',
    'cheah',
    'chong',
    'chew',
    'goh',
    'khoo',
    'kong',
    'lau',
    'leong',
    'liew',
    'loh',
    'low',
    'ng',
    'ong',
    'sim',
    'teoh',
    'toh',
    'yap',
    'yeo',
    'yong',
    'chin',
    'foo',
    'ho',
    'kang',
    'koh',
    'lai',
    'wei',
    'ming',
    'hui',
    'jia',
    'xin',
    'yi',
    'ling',
    'mei',
    'siew',
    'chee',
    // Pinyin surnames (#385). Mandarin translation spells a name the way the
    // mainland does, not the Hokkien or Cantonese romanisations above: 陈 comes
    // back "Chen", never "Tan". Left out because each is also an English or Malay
    // word: he, sun, song, ma, hu, ye, yu, du, lu, su, pan, han, tang, ding, dong.
    'chen',
    'wang',
    'zhang',
    'liu',
    'huang',
    'zhao',
    'zhou',
    'wu',
    'xu',
    'zhu',
    'guo',
    'luo',
    'zheng',
    'liang',
    'xie',
    'deng',
    'cao',
    'peng',
    'zeng',
    'xiao',
    'jiang',
    'cheng',
    'cai',
    'yuan',
    'shen',
    'yao',
    'lin',
    'gao',
    'tian',
    'zhong',
    // Indian
    'arumugam',
    'balakrishnan',
    'chandran',
    'ganesan',
    'gopal',
    'krishnan',
    'kumar',
    'kumaran',
    'maniam',
    'muniandy',
    'murugan',
    'nadarajah',
    'raj',
    'rajan',
    'ramasamy',
    'ravi',
    'samy',
    'selvam',
    'subramaniam',
    'suresh',
    'thanaraj',
    'vellu',
    'devi',
    'kaur',
    'lakshmi',
    'priya',
    'shanti',
    'usha',
    'singh',
    'anand',
    'deepa',
    'kavitha',
    'meena',
    'nithya',
    // Pakistani and Bangladeshi (#391). Urdu and Bengali translation puts these
    // names, transliterated, into English transcripts. A name listed above
    // appears again where these communities spell it differently ('fatima',
    // 'hasan'), because the lookup is exact. 'bilal' and 'arif' are absent
    // although common: both are Malay words (a mosque's muezzin; knowledgeable).
    'asif',
    'imran',
    'tariq',
    'rashid',
    'kashif',
    'faisal',
    'usman',
    'hamza',
    'zubair',
    'naveed',
    'shahid',
    'sajid',
    'adnan',
    'arshad',
    'javed',
    'nadeem',
    'sohail',
    'zahid',
    'aamir',
    'ayesha',
    'fatima',
    'sadia',
    'rabia',
    'saima',
    'bushra',
    'uzma',
    'karim',
    'rafiq',
    'rafiqul',
    'nazrul',
    'shafiq',
    'mizanur',
    'habibur',
    'kamrul',
    'jahangir',
    'shahidul',
    'hasan',
    'monir',
    'sumon',
    'rubel',
    'shakil',
    'sabbir',
    'tanvir',
    'masud',
    'mamun',
    'nasrin',
    'taslima',
    'shirin',
    'rokeya',
    'sanjoy',
    'bishwajit',
    'pradip',
    'dipankar',
    'subrata',
    'tapan',
    'uttam',
    'shyamal',
    'liton',
    'kalpana',
    'shikha',
    'anjali',
    'sabita',
    // Leading elements. Only the first word of a run is looked up, so an
    // unlisted one hides every listed name behind it. 'md' is Bangladesh's 'mohd'.
    'mohammad',
    'mohammed',
    'md',
    'syed',
    'abdur',
    'qazi',
    'sheikh',
    'shaikh',
    'hafiz',
    // Second elements, only those used on their own as a form of address, as
    // 'singh' and 'kaur' are. The rest ('uddin', 'akter', 'khatun', 'miah') are
    // left to the adjacency rules.
    'khan',
    'hossain',
    'hussain',
    'ahmed',
    'rahman',
    'chowdhury',
    'begum',
  ].map((n) => n.toLowerCase()),
)

/**
 * Every drug the medication lexicon spells, word by word as the detector reads
 * one, hyphenated parts included (#317). Derived rather than copied, so a drug
 * added to the lexicon is never taken for part of a patient's name.
 */
const DRUG_NAME_WORDS = MEDICATION_LEXICON.flatMap(({ generic, synonyms }) => [
  generic,
  ...synonyms,
])
  .flatMap((term) => term.split(/\s+/))
  .flatMap((word) => [word, ...word.split('-')])
  .map((word) => word.toLowerCase().replace(/[^a-z]/g, ''))

/**
 * Words that look like names by shape but are clinical, geographic or
 * conversational. Without this the detector tokenises half the transcript,
 * which destroys the note rather than protecting it.
 */
export const NAME_STOPWORDS = new Set(
  [
    'doctor',
    'patient',
    'clinic',
    'hospital',
    'panel',
    'pharmacy',
    'nurse',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    ...DRUG_NAME_WORDS,
    'lozenge',
    'antibiotic',
    'antibiotics',
    'covid',
    'influenza',
    'urti',
    // English symptoms, beside the Malay ones below, so a symptom opening a
    // sentence before a name stays in the note rather than inside the token
    // (#413). No Malaysian given name or surname takes any of these. Fever
    // is absent because it is a checklist id, which the clinical-constants
    // guard keeps out of source; a run it opens is still tokenised, whole.
    'cough',
    'flu',
    'cold',
    'sore',
    'throat',
    'pain',
    'headache',
    'phlegm',
    'runny',
    'nose',
    'rash',
    'vomiting',
    'diarrhoea',
    'diarrhea',
    'chills',
    'dizzy',
    'nausea',
    // Brands, which the medication lexicon deliberately leaves out (D-001), so
    // the derived drug words above cannot cover them (#413).
    'panadol',
    'strepsils',
    'augmentin',
    'ventolin',
    'piriton',
    'difflam',
    'mc',
    'ic',
    'nric',
    'mykad',
    'rm',
    'yes',
    'no',
    'ok',
    'okay',
    'sorry',
    'thanks',
    'thank',
    'please',
    'hello',
    'good',
    'morning',
    'afternoon',
    'evening',
    'night',
    'today',
    'yesterday',
    'tomorrow',
    'week',
    'day',
    'days',
    'month',
    'year',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'the',
    'and',
    'but',
    'so',
    'my',
    'your',
    'his',
    'her',
    'their',
    'this',
    'that',
    'have',
    'has',
    'had',
    // Verbs and prepositions that introduce a name in dictated clinical prose.
    // Load-bearing since #149: `trimNameSpan` no longer skips to the gazetteer
    // anchor past a word it does not recognise, because doing so leaked the
    // leading element of any name outside the gazetteer. The cost of that fix
    // is that an unrecognised word before a name now stays inside the span, and
    // stopwords are the sanctioned lever for taking it back out again.
    //
    // Every entry here is a word no Malaysian given name or surname takes.
    // 'see' is deliberately absent although it fits the pattern, because See is
    // an attested Chinese Malaysian surname and a false stopword truncates a
    // real name, which is the failure mode that outranks this one.
    'also',
    'then',
    'did',
    'mother',
    'father',
    'auntie',
    'uncle',
    'tell',
    'call',
    'ask',
    'asked',
    'meet',
    'send',
    'bring',
    'let',
    'give',
    'refer',
    'review',
    'admit',
    'advise',
    'inform',
    'saw',
    'seen',
    'seeing',
    'attended',
    'presented',
    // English symptom vocabulary is deliberately NOT here, although it would
    // help. `no-stray-clinical-constants.test.ts` refuses it, because several
    // of those words are versioned red-flag terms and a clinical rule written
    // down outside the versioned data is exactly what that guard exists to
    // stop. The gap it leaves is a Title-Cased symptom in front of a name
    // staying inside the span; that is pinned as known-bad and belongs to #183,
    // whose fix removes the need for a vocabulary list here at all.
    'is',
    'was',
    'are',
    'were',
    'for',
    'with',
    'about',
    'from',
    'name',
    // Malay everyday words. Load-bearing against the bare 'saya' introducer:
    // without these, "...untuk saya Doktor" mints a false PATIENT token, and a
    // false token corrupts the note on rehydration. Deliberately absent
    // although they are months or weekdays: 'mei' (a given name in
    // GIVEN_NAMES) and 'khamis', 'jumaat', 'sabtu', 'ahad' (attested Malay
    // given names outside the gazetteer, where trimNameSpan's stopword loop
    // would strip them off a patronymic span and leak them in cleartext).
    // A recall loss on the PHI boundary outranks the precision gain.
    'doktor',
    'klinik',
    'jururawat',
    'ubat',
    'sakit',
    'demam',
    'batuk',
    'selsema',
    'pesakit',
    'farmasi',
    'isnin',
    'selasa',
    'rabu',
    'januari',
    'februari',
    'mac',
    'jun',
    'julai',
    'ogos',
    'oktober',
    'disember',
    'malaysia',
    'selangor',
    'johor',
    'penang',
    'sabah',
    'sarawak',
    'perak',
    'kedah',
    'kelantan',
    'melaka',
    'pahang',
    'perlis',
    'terengganu',
    'kuala',
    'lumpur',
    'putrajaya',
    'labuan',
    // Deliberately absent although they spell a Selangor city: 'shah' and
    // 'alam' are common Pakistani and Bangladeshi surnames, and as stopwords
    // trimNameSpan stripped them off the end of a name and left them in
    // cleartext (#391). A recall loss on the PHI boundary outranks the
    // precision gain.
    'petaling',
    'jaya',
  ].map((w) => w.toLowerCase()),
)

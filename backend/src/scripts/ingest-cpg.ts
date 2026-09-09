import { execFile as execFileCb } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { env } from '../config/env.js'
import { assertNoIdentifiers, deidentify } from '../deid/index.js'
import type { Deidentified } from '../deid/types.js'
import { getEmbeddingClient } from '../lib/llm/embeddings.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'

const execFile = promisify(execFileCb)

const RAW_DIR = path.resolve(import.meta.dirname, '../../../corpus/cpg/raw')
const MANIFEST_PATH = path.resolve(import.meta.dirname, '../../../corpus/cpg/manifest.json')

const MAX_CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 150
const MIN_CHUNK_SIZE = 120
const SCANNED_THRESHOLD = 80
const HEADING_MAX_LENGTH = 90
const HEADING_PATTERN =
  /^(?:\d+(?:\.\d+)*(?:\s+[A-Z][A-Z\s]+)?|[A-Z][A-Z\s]+\d+|\p{Lu}[\p{Lu}\s]+)$/u

export interface Manifest {
  source: string
  publisher: string
  jurisdiction: string
  sourceLicence: string
  verbatimAllowed: boolean
  documents: ManifestDocument[]
}

export interface ManifestDocument {
  id: string
  title: string
  year: number
  sourceUrl: string
  file: string | null
  profiles: string[]
  /**
   * Per-document attribution and licence, overriding the manifest's top-level
   * values.
   *
   * The manifest began as one corpus from one publisher under one licence, so
   * all three lived at the top level and every row inherited them. That stops
   * working the moment a second source is added: an open-access paper and an
   * all-rights-reserved guideline cannot share one `verbatimAllowed`, and
   * `retrieve.ts` hands `chunk.text` to the doctor as the citation body, so
   * the flag decides whether a span may be shown verbatim at all. `publisher`
   * is the same problem in the citation line rather than the licence. Absent
   * means "inherit", which keeps every existing entry reading as before.
   */
  publisher?: string
  sourceLicence?: string
  verbatimAllowed?: boolean
}

/** Per-document attribution and licence where set, the manifest's otherwise. */
export function resolveDocumentFields(
  doc: Pick<ManifestDocument, 'publisher' | 'sourceLicence' | 'verbatimAllowed'>,
  manifest: Pick<Manifest, 'publisher' | 'sourceLicence' | 'verbatimAllowed'>,
): { publisher: string; sourceLicence: string; verbatimAllowed: boolean } {
  return {
    publisher: doc.publisher ?? manifest.publisher,
    sourceLicence: doc.sourceLicence ?? manifest.sourceLicence,
    verbatimAllowed: doc.verbatimAllowed ?? manifest.verbatimAllowed,
  }
}

/**
 * What an unchanged PDF still syncs from the manifest on re-ingest. Scope and
 * licence are metadata, so an operator edits one file and re-runs; the
 * licence must come through the per-document resolution or a re-run would
 * quietly reset a `verbatimAllowed: false` document to the manifest default.
 */
export function manifestSyncData(
  doc: Pick<ManifestDocument, 'profiles' | 'publisher' | 'sourceLicence' | 'verbatimAllowed'>,
  manifest: Pick<Manifest, 'publisher' | 'sourceLicence' | 'verbatimAllowed'>,
): {
  profiles: string[]
  publisher: string
  sourceLicence: string
  verbatimAllowed: boolean
} {
  return { profiles: [...doc.profiles], ...resolveDocumentFields(doc, manifest) }
}

export interface ChunkSpec {
  id: string
  documentId: string
  page: number
  ordinal: number
  heading: string | null
  text: string
  ocr: boolean
}

export interface IngestFlags {
  only: string[]
  dryRun: boolean
  skipUpload: boolean
  force: boolean
}

export interface IngestSummary {
  documentId: string
  pages: number
  ocrPages: number
  chunks: number
  uploaded: boolean
}

export function parseFlags(argv: string[]): IngestFlags {
  const only: string[] = []
  let dryRun = false
  let skipUpload = false
  let force = false
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--only') {
      const next = argv[i + 1]
      if (!next) throw new Error('--only requires a document id')
      only.push(next)
      i++
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--skip-upload') {
      skipUpload = true
    } else if (arg === '--force') {
      force = true
    }
  }
  return { only, dryRun, skipUpload, force }
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      if (typeof chunk === 'string') {
        hash.update(chunk, 'utf8')
      } else {
        hash.update(chunk)
      }
    })
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export function normalise(input: string): string {
  let s = input.toLowerCase()
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  s = s.replace(/\bmanagement of\b/g, ' ')
  s = s.replace(/\bthe\b/g, ' ')
  s = s.replace(/\b(?:edition|ed)\b/g, ' ')
  s = s.replace(/\b\d+(?:st|nd|rd|th)\b/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function fileIdFromUrl(url: string): string | null {
  const match = url.match(/fileid=(\d+)/)
  return match?.[1] ?? null
}

export function findManifestMatch(
  fileName: string,
  firstPageText: string | null,
  manifest: Manifest,
): ManifestDocument | null {
  const base = path.basename(fileName)
  const stem = base.replace(/\.pdf$/i, '')

  const byFile = manifest.documents.find((d) => d.file === base)
  if (byFile) return byFile

  const numbers = [...stem.matchAll(/\d{3,}/g)].map((m) => m[0])
  const idMatches = new Map<string, ManifestDocument>()
  for (const n of numbers) {
    const doc = manifest.documents.find((d) => fileIdFromUrl(d.sourceUrl) === n)
    if (doc) idMatches.set(doc.id, doc)
  }
  if (idMatches.size === 1) return [...idMatches.values()][0] ?? null

  const normalisedStem = normalise(stem)
  const byTitle: ManifestDocument[] = []
  for (const doc of manifest.documents) {
    const n = normalise(doc.title)
    if (n && normalisedStem && (n.includes(normalisedStem) || normalisedStem.includes(n))) {
      byTitle.push(doc)
    }
  }

  if (firstPageText) {
    const normalisedPage = normalise(firstPageText)
    const byPage: ManifestDocument[] = []
    for (const doc of manifest.documents) {
      const n = normalise(doc.title)
      if (n && normalisedPage.includes(n)) byPage.push(doc)
    }
    if (byPage.length > 0) {
      byPage.sort((a, b) => normalise(b.title).length - normalise(a.title).length)
      return byPage[0] ?? null
    }
  }

  if (byTitle.length === 1) return byTitle[0] ?? null
  if (byTitle.length > 0) {
    byTitle.sort((a, b) => normalise(b.title).length - normalise(a.title).length)
    return byTitle[0] ?? null
  }

  return null
}

export function isScannedPage(text: string): boolean {
  return text.replace(/\s/g, '').length < SCANNED_THRESHOLD
}

const CHROME_DATE_TIME_PATTERN =
  /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}),\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s+/i
const FOOTER_URL_PATTERN = /^\s*(\S+?:\/\/\S+?)(?:\s+\d{1,4}\/\d{1,4})?\s*$/

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function stripChromeDateTime(line: string): string {
  return line.replace(CHROME_DATE_TIME_PATTERN, '').trim()
}

function parseChromeFooterUrl(line: string): string | null {
  const match = line.match(FOOTER_URL_PATTERN)
  return match?.[1] ?? null
}

// A bare URL, alone on the last line, optionally followed by an `n/m` page
// counter, is Chrome's print footer on its own evidence. It cannot be gated
// on running-header membership: a site rendered section by section carries a
// different URL per section, each far below the repeat threshold.
function isFooterLine(line: string): boolean {
  return parseChromeFooterUrl(line) !== null
}

// A running header is a phrase, not a word. Table column labels ("Preferred",
// "Alternative", "Comments") and connectives ("or") recur on most pages of a
// dosing guideline and stripping them cuts an alternative out of its row.
const RUNNING_HEADER_MIN_CHARS = 12
const RUNNING_HEADER_MIN_WORDS = 3

function isRunningHeaderCandidate(key: string): boolean {
  if (/^\S+:\/\/\S+$/.test(key)) return true
  return key.length >= RUNNING_HEADER_MIN_CHARS && key.split(' ').length >= RUNNING_HEADER_MIN_WORDS
}

export function computeRunningHeaders(rawPages: string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const page of rawPages) {
    const seen = new Set<string>()
    const lines = page.split('\n')
    let firstIndex = -1
    let lastIndex = -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (!line.trim() || /^\d+$/.test(line.trim())) continue
      if (firstIndex === -1) firstIndex = i
      lastIndex = i
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (!line.trim() || /^\d+$/.test(line.trim())) continue
      let key: string
      if (i === firstIndex) {
        const stripped = stripChromeDateTime(line)
        key = collapseSpaces(stripped)
        const dashIndex = key.indexOf(' - ')
        if (dashIndex > 0) {
          const prefix = key.slice(0, dashIndex).trim()
          if (prefix && !seen.has(prefix)) {
            seen.add(prefix)
            counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
          }
        }
      } else if (i === lastIndex) {
        const url = parseChromeFooterUrl(line)
        key = url ? collapseSpaces(url) : collapseSpaces(line)
      } else {
        key = collapseSpaces(line)
      }
      if (!key || /^\d+$/.test(key)) continue
      if (!isRunningHeaderCandidate(key)) continue
      if (!seen.has(key)) {
        seen.add(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  const threshold = Math.max(1, rawPages.length * 0.3)
  const headers = new Set<string>()
  for (const [line, count] of counts) {
    if (count > threshold) headers.add(line)
  }
  return headers
}

function isHeading(text: string): boolean {
  if (text.length >= HEADING_MAX_LENGTH) return false
  if (/[.!?]$/.test(text)) return false
  return HEADING_PATTERN.test(text)
}

function isPageNumberLine(line: string): boolean {
  return /^\s*\d+\s*$/.test(line)
}

export function cleanPage(rawText: string, headerSet: Set<string>): string {
  const rawLines = rawText.split('\n')
  const keep: string[] = []
  let firstContent = true
  for (const line of rawLines) {
    if (isPageNumberLine(line)) continue
    if (firstContent && line.trim()) {
      const stripped = collapseSpaces(stripChromeDateTime(line))
      if (stripped && headerSet.has(stripped)) {
        firstContent = false
        continue
      }
      const dashIndex = stripped.indexOf(' - ')
      if (dashIndex >= 0) {
        const prefix = stripped.slice(0, dashIndex).trim()
        if (prefix && headerSet.has(prefix)) {
          firstContent = false
          continue
        }
      }
      firstContent = false
    } else if (!firstContent) {
      const collapsed = collapseSpaces(line)
      if (headerSet.has(collapsed)) continue
    }
    keep.push(line)
  }

  while (keep.length > 0 && !(keep[keep.length - 1] ?? '').trim()) keep.pop()
  if (keep.length > 0 && isFooterLine(keep[keep.length - 1] ?? '')) {
    keep.pop()
    while (keep.length > 0 && !(keep[keep.length - 1] ?? '').trim()) keep.pop()
  }

  for (let i = 0; i < keep.length; ) {
    const current = keep[i]
    if (!current) {
      i++
      continue
    }
    const trimmed = current.trimEnd()
    keep[i] = trimmed
    const match = trimmed.match(/^(.*)([a-z]+)-$/)
    if (!match) {
      i++
      continue
    }
    const prefix = match[1]
    const stem = match[2]
    if (!stem) {
      i++
      continue
    }
    const next = keep.at(i + 1)
    if (!next) {
      i++
      continue
    }
    const nextMatch = next.match(/^([a-z]+)\b/)
    if (!nextMatch) {
      i++
      continue
    }
    const suffix = nextMatch[1]
    if (!suffix) {
      i++
      continue
    }
    const joined = stem + suffix
    if (!/^[a-z]+$/.test(joined)) {
      i++
      continue
    }
    keep[i] = prefix + joined + next.slice(nextMatch[0].length)
    keep.splice(i + 1, 1)
  }

  const paragraphs: string[] = []
  let current: string[] = []
  for (const line of keep) {
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (!trimmed) {
      if (current.length) {
        paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim())
        current = []
      }
      continue
    }
    current.push(trimmed)
  }
  if (current.length) paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim())

  return paragraphs.filter((p) => p.length > 0).join('\n\n')
}

interface HeadingEntry {
  text: string
  offset: number
}

export function findHeadings(pageText: string): HeadingEntry[] {
  const headings: HeadingEntry[] = []
  let offset = 0
  for (const paragraph of pageText.split('\n\n')) {
    if (isHeading(paragraph)) headings.push({ text: paragraph, offset })
    offset += paragraph.length + 2
  }
  return headings
}

function findBreakPoint(text: string, start: number, maxEnd: number): number {
  const window = text.slice(start, maxEnd)

  const idx = window.lastIndexOf('\n\n')
  if (idx > 0) return start + idx

  const sentenceBreaks: number[] = []
  for (const m of window.matchAll(/[.!?]\s/g)) {
    const breakPos = start + m.index + 1
    if (breakPos > start + MIN_CHUNK_SIZE) sentenceBreaks.push(breakPos)
  }
  if (sentenceBreaks.length > 0) return sentenceBreaks.at(-1) ?? maxEnd

  const spaceIdx = window.lastIndexOf(' ')
  if (spaceIdx > MIN_CHUNK_SIZE) return start + spaceIdx

  return maxEnd
}

export function chunkPage(
  pageText: string,
  pageNumber: number,
  documentId: string,
  startOrdinal: number,
  ocr = false,
): { chunks: ChunkSpec[]; nextOrdinal: number } {
  const headings = findHeadings(pageText)

  const candidates: ChunkSpec[] = []
  let pos = 0
  while (pos < pageText.length) {
    const remaining = pageText.length - pos
    const heading = headings.filter((h) => h.offset <= pos).at(-1)?.text ?? null

    if (remaining <= MAX_CHUNK_SIZE) {
      const text = pageText.slice(pos)
      candidates.push({
        id: '',
        documentId,
        page: pageNumber,
        ordinal: 0,
        heading,
        text,
        ocr,
      })
      break
    }

    const maxEnd = pos + MAX_CHUNK_SIZE
    const breakPoint = findBreakPoint(pageText, pos, maxEnd)
    const end = breakPoint > pos ? breakPoint : maxEnd
    const chunkLen = end - pos
    const text = pageText.slice(pos, end)

    if (chunkLen >= MIN_CHUNK_SIZE) {
      candidates.push({
        id: '',
        documentId,
        page: pageNumber,
        ordinal: 0,
        heading,
        text,
        ocr,
      })
    }

    if (chunkLen <= CHUNK_OVERLAP) {
      pos = end
    } else {
      pos = end - CHUNK_OVERLAP
    }
  }

  const keep: ChunkSpec[] = []
  for (const c of candidates) {
    if (candidates.length > 1 && c.text.length < MIN_CHUNK_SIZE) continue
    keep.push({
      ...c,
      id: `${documentId}-p${pageNumber}-c${startOrdinal + keep.length}`,
      ordinal: startOrdinal + keep.length,
    })
  }

  return { chunks: keep, nextOrdinal: startOrdinal + keep.length }
}

const EXEC_OPTIONS = { maxBuffer: 256 * 1024 * 1024 }

/**
 * One entry per physical page, empty string included: a scanned page has no
 * text layer, and dropping it would shift every later page number, which is
 * the provenance a doctor clicks through to. `pdfinfo` is the authority on
 * the count; the form-feed split only fills it in.
 */
export async function extractText(filePath: string): Promise<string[]> {
  const info = await execFile('pdfinfo', [filePath], EXEC_OPTIONS)
  const pageCount = Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] ?? 0)
  const { stdout } = await execFile('pdftotext', ['-layout', filePath, '-'], EXEC_OPTIONS)
  const pages = stdout.split('\f').map((p: string) => p.trim())
  return Array.from({ length: pageCount }, (_, i) => pages[i] ?? '')
}

export async function extractFirstPageText(filePath: string): Promise<string> {
  const { stdout } = await execFile(
    'pdftotext',
    ['-layout', '-f', '1', '-l', '1', filePath, '-'],
    EXEC_OPTIONS,
  )
  return stdout.trim()
}

export async function ocrPage(
  filePath: string,
  pageNumber: number,
  tmpDir: string,
): Promise<string> {
  const prefix = path.join(tmpDir, 'page')
  await execFile(
    'pdftoppm',
    [
      '-singlefile',
      '-r',
      '200',
      '-f',
      String(pageNumber),
      '-l',
      String(pageNumber),
      '-png',
      filePath,
      prefix,
    ],
    EXEC_OPTIONS,
  )
  const pngPath = `${prefix}.png`
  const { stdout } = await execFile(
    'tesseract',
    [pngPath, 'stdout', '-l', 'eng+msa', '--psm', '1'],
    EXEC_OPTIONS,
  )
  return stdout.trim()
}

async function loadManifest(): Promise<Manifest> {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8')
  return JSON.parse(raw) as Manifest
}

async function saveManifest(manifest: Manifest): Promise<void> {
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function findPdfs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(RAW_DIR)
    return entries.filter((e) => e.toLowerCase().endsWith('.pdf')).map((e) => path.join(RAW_DIR, e))
  } catch {
    return []
  }
}

function bucketName(): string {
  return env.SUPABASE_GUIDELINES_BUCKET
}

async function uploadPdf(documentId: string, filePath: string): Promise<string | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  const bucket = bucketName()
  const url = `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${documentId}.pdf`
  const bytes = await fs.readFile(filePath)
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (res.status !== 200) {
    logger.warn('upload failed', { status: res.status })
    return null
  }
  return `${bucket}/${documentId}.pdf`
}

/**
 * Guideline pages that list a development group defeat the name detector's
 * single pass: tokenising one name changes the context the next one is read
 * in, and the egress assertion then finds what the first pass left. Author
 * names are not patient data, but the gate has one rule, so the chunk is run
 * through it until it passes or, after three passes, left without an
 * embedding. Lexical search still covers such a chunk.
 */
const GATE_PASSES = 3

/**
 * A 200-page guideline is several hundred embedding writes in one
 * transaction, well past Prisma's five-second default. Sized for the largest
 * CPG on the portal with headroom; the pooled connection stays open for it.
 */
const TRANSACTION_OPTIONS = { timeout: 10 * 60_000, maxWait: 60_000 }

export function gateForEgress(text: string): Deidentified | null {
  let current = text
  for (let pass = 0; pass < GATE_PASSES; pass++) {
    const gated = deidentify(current).text
    try {
      assertNoIdentifiers(gated, 'cpg_ingest')
      return gated
    } catch {
      current = gated
    }
  }
  return null
}

async function writeDocument(
  doc: ManifestDocument,
  manifest: Manifest,
  sha256: string,
  pageCount: number,
  chunks: ChunkSpec[],
  storagePath: string | null,
): Promise<void> {
  const gated: Array<{ index: number; text: Deidentified }> = []
  for (const [index, chunk] of chunks.entries()) {
    const text = gateForEgress(chunk.text)
    if (text !== null) gated.push({ index, text })
  }
  const embeddings = await getEmbeddingClient().embed(
    gated.map((g) => g.text),
    'cpg_ingest',
  )
  const ungated = chunks.length - gated.length
  if (ungated > 0) {
    logger.warn(`${doc.id}: ${ungated} chunk(s) left without an embedding by the egress gate`, {
      count: ungated,
    })
  }

  const fields = resolveDocumentFields(doc, manifest)

  await prisma.$transaction(async (tx) => {
    await tx.guidelineChunk.deleteMany({ where: { documentId: doc.id } })
    await tx.guidelineDocument.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        title: doc.title,
        publisher: fields.publisher,
        year: doc.year,
        sourceUrl: doc.sourceUrl,
        jurisdiction: manifest.jurisdiction,
        sourceLicence: fields.sourceLicence,
        sha256,
        pageCount,
        storagePath,
        profiles: [...doc.profiles],
        verbatimAllowed: fields.verbatimAllowed,
      },
      update: {
        title: doc.title,
        publisher: fields.publisher,
        year: doc.year,
        sourceUrl: doc.sourceUrl,
        jurisdiction: manifest.jurisdiction,
        sourceLicence: fields.sourceLicence,
        sha256,
        pageCount,
        storagePath,
        profiles: [...doc.profiles],
        verbatimAllowed: fields.verbatimAllowed,
        ingestedAt: new Date(),
      },
    })
    await tx.guidelineChunk.createMany({
      data: chunks.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        page: c.page,
        ordinal: c.ordinal,
        heading: c.heading,
        text: c.text,
        ocr: c.ocr,
      })),
    })
    for (const [i, { index }] of gated.entries()) {
      const vector = JSON.stringify(embeddings[i])
      const id = chunks[index]?.id
      if (id === undefined) continue
      await tx.$executeRaw`UPDATE "guideline_chunk" SET "embedding" = ${vector}::vector WHERE "id" = ${id}`
    }
  }, TRANSACTION_OPTIONS)
}

async function processDocument(
  filePath: string,
  manifest: Manifest,
  flags: IngestFlags,
): Promise<IngestSummary | null> {
  const fileName = path.basename(filePath)
  const sha256 = await sha256File(filePath)

  let doc = findManifestMatch(fileName, null, manifest)

  if (!doc) {
    const firstPageText = await extractFirstPageText(filePath)
    doc = findManifestMatch(fileName, firstPageText, manifest)
  }

  if (!doc) {
    logger.warn(`no manifest match for ${fileName}`)
    return null
  }

  if (flags.only.length > 0 && !flags.only.includes(doc.id)) {
    return null
  }

  doc.file = fileName

  if (!flags.dryRun) {
    const existing = await prisma.guidelineDocument.findUnique({ where: { id: doc.id } })
    if (existing && existing.sha256 === sha256 && !flags.force) {
      await prisma.guidelineDocument.update({
        where: { id: doc.id },
        data: manifestSyncData(doc, manifest),
      })
      logger.info(`unchanged, skipping ${doc.id} (scope synced)`)
      return null
    }
  }

  const rawPages = await extractText(filePath)
  const headerSet = computeRunningHeaders(rawPages)

  const cleanedPages: string[] = []
  const ocrFlags: boolean[] = []
  const firstHeadings: (string | null)[] = []
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpg-'))

  try {
    for (const [i, rawText] of rawPages.entries()) {
      const pageNumber = i + 1
      let pageText = rawText
      let ocr = false
      if (isScannedPage(rawText)) {
        pageText = await ocrPage(filePath, pageNumber, tmpDir)
        ocr = true
      }
      const cleaned = cleanPage(pageText, headerSet)
      cleanedPages.push(cleaned)
      ocrFlags.push(ocr)
      const heading = findHeadings(cleaned)[0]?.text ?? null
      if (i < 3) firstHeadings.push(heading)
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }

  let ordinal = 1
  const allChunks: ChunkSpec[] = []
  for (const [i, pageText] of cleanedPages.entries()) {
    const result = chunkPage(pageText, i + 1, doc.id, ordinal, ocrFlags[i])
    allChunks.push(...result.chunks)
    ordinal = result.nextOrdinal
  }

  const ocrPages = ocrFlags.filter(Boolean).length
  const summary: IngestSummary = {
    documentId: doc.id,
    pages: rawPages.length,
    ocrPages,
    chunks: allChunks.length,
    uploaded: false,
  }

  if (flags.dryRun) {
    process.stdout.write(
      `${summary.documentId}: pages=${summary.pages} ocrPages=${summary.ocrPages} chunks=${summary.chunks}\n`,
    )
    for (const [i, heading] of firstHeadings.entries()) {
      process.stdout.write(`  page ${i + 1} heading: ${heading ?? '(none)'}\n`)
    }
    return summary
  }

  try {
    let storagePath: string | null = null
    if (!flags.skipUpload && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      storagePath = await uploadPdf(doc.id, filePath)
    }
    await writeDocument(doc, manifest, sha256, rawPages.length, allChunks, storagePath)
    summary.uploaded = storagePath !== null
  } catch (error) {
    logger.warn(`document ingest failed for ${doc.id}`, {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return null
  }

  logger.info(
    `document ${summary.documentId} pages=${summary.pages} ocrPages=${summary.ocrPages} chunks=${summary.chunks} uploaded=${summary.uploaded}`,
  )
  return summary
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv)
  const manifest = await loadManifest()
  const pdfs = await findPdfs()

  if (pdfs.length === 0) {
    logger.info('no PDFs found in corpus/cpg/raw')
    return
  }

  const summaries: IngestSummary[] = []
  for (const pdf of pdfs) {
    const summary = await processDocument(pdf, manifest, flags)
    if (summary) summaries.push(summary)
  }

  if (flags.dryRun) {
    await saveManifest(manifest)
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      pages: acc.pages + s.pages,
      ocrPages: acc.ocrPages + s.ocrPages,
      chunks: acc.chunks + s.chunks,
      uploaded: acc.uploaded + (s.uploaded ? 1 : 0),
    }),
    { pages: 0, ocrPages: 0, chunks: 0, uploaded: 0 },
  )
  logger.info(
    `total documents=${summaries.length} pages=${totals.pages} ocrPages=${totals.ocrPages} chunks=${totals.chunks} uploaded=${totals.uploaded}`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    logger.error(`ingest failed: ${error instanceof Error ? error.message : 'unknown'}`, {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    process.exit(1)
  })
}

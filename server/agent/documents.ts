import { PDFParse } from 'pdf-parse'
import * as db from '../db.js'
import { cosine, embed, embeddingsConfigured, fromBlob, toBlob } from './embeddings.js'

// ── The customer's own material ───────────────────────────────────────────────
// Upload a syllabus, a reading list, a set of notes; the planner then works
// from what is actually in them instead of guessing.
//
// Retrieval prefers embeddings (meaning), and falls back to keyword overlap
// when the embedder is unavailable — a degraded answer beats a broken feature,
// and the fallback is also what keeps this working offline.

/** Similarity below this is noise — see the note in `retrieve`. */
const RELEVANCE_FLOOR = Number(process.env.EMBED_RELEVANCE_FLOOR ?? 0.1)
const CHUNK_CHARS = 900
/** Only genuinely tiny fragments (a heading, a one-line bullet) get merged.
 *  Merging more than that dilutes a passage until it matches nothing. */
const MERGE_UNDER = 120
const CHUNK_OVERLAP = 150
export const MAX_DOC_CHARS = 400_000

/**
 * Split into passages, keeping semantic units apart.
 *
 * Packing text up to a size limit is the obvious approach and the wrong one:
 * a chunk covering four unrelated topics matches none of them strongly, so a
 * whole small document ends up as one chunk that fails every query. Each
 * paragraph therefore stands alone unless it is too short to carry meaning.
 */
export function chunk(text: string): string[] {
  let clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []

  // Extracted text separates ideas with single newlines, not blank lines. Test
  // whether blank lines are actually *prevalent* — a document with one stray
  // blank line would otherwise arrive as a single undifferentiated blob.
  const singles = (clean.match(/\n/g) ?? []).length
  const doubles = (clean.match(/\n\n/g) ?? []).length
  if (singles > 0 && doubles / singles < 0.25) clean = clean.replace(/\n+/g, '\n\n')

  const paragraphs = clean.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }

  for (const para of paragraphs) {
    // A single oversized paragraph still has to be cut, with overlap so a fact
    // split across the seam is findable from either side.
    if (para.length > CHUNK_CHARS) {
      flush()
      for (let i = 0; i < para.length; i += CHUNK_CHARS - CHUNK_OVERLAP) {
        chunks.push(para.slice(i, i + CHUNK_CHARS).trim())
      }
      continue
    }
    if (!current) {
      current = para
    } else if (current.length < MERGE_UNDER && current.length + para.length + 2 <= CHUNK_CHARS) {
      // Too small to stand alone (a heading, a one-line bullet) — join it on.
      current = `${current}\n\n${para}`
    } else {
      flush()
      current = para
    }
  }
  flush()
  return chunks.filter((c) => c.length > 20)
}

/**
 * PDFs come out as hard-wrapped lines with page markers: a sentence is split
 * across several lines, and "-- 1 of 3 --" sits between pages. Left alone,
 * that noise decides where passages begin and end. Rejoin wrapped lines, and
 * keep a real line break only where a line actually finished a thought.
 */
export function normalizePdfText(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
    .split('\n')
    .map((l) => l.trim())

  const out: string[] = []
  for (const line of lines) {
    if (!line) continue
    const previous = out[out.length - 1]
    const continues =
      previous &&
      !/[.!?:;]$/.test(previous) &&
      // A new bullet or numbered item starts a line even mid-sentence.
      !/^[-•*\d]/.test(line) &&
      /^[a-z(]/.test(line)
    if (continues) out[out.length - 1] = `${previous} ${line}`
    else out.push(line)
  }
  return out.join('\n')
}

/** Pull readable text out of an upload. */
export async function extractText(
  buffer: Buffer,
  filename: string
): Promise<{ text: string; kind: string }> {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      return { text: normalizePdfText(result.text ?? ''), kind: 'pdf' }
    } finally {
      await parser.destroy()
    }
  }
  const text = buffer.toString('utf8')
  // A binary file read as UTF-8 is mostly replacement characters — refuse it
  // rather than indexing noise.
  const replacementRatio = (text.match(/�/g)?.length ?? 0) / Math.max(text.length, 1)
  if (replacementRatio > 0.1) throw new Error('That file does not look like text or a PDF.')
  const kind = lower.endsWith('.md') ? 'markdown' : lower.endsWith('.csv') ? 'csv' : 'text'
  return { text, kind }
}

export interface IngestResult {
  id: number
  name: string
  chunks: number
  indexedAs: 'embedded' | 'keyword'
  note?: string
}

/** Chunk, embed and store one document. */
export async function ingest(
  userId: number,
  filename: string,
  buffer: Buffer
): Promise<IngestResult> {
  const { text, kind } = await extractText(buffer, filename)
  if (text.trim().length < 40) throw new Error('There is no readable text in that file.')
  if (text.length > MAX_DOC_CHARS) {
    throw new Error(`That document is too large (${Math.round(text.length / 1000)}k characters).`)
  }

  const pieces = chunk(text)
  if (!pieces.length) throw new Error('There is no readable text in that file.')

  const doc = db.createDocument({ userId, name: filename.slice(0, 120), kind, chars: text.length })

  let vectors: Float32Array[] | null = null
  let note: string | undefined
  if (embeddingsConfigured()) {
    try {
      vectors = await embed(pieces, 'passage')
    } catch (err) {
      // Keep the document — keyword search still finds it.
      note = `Stored without embeddings (${err instanceof Error ? err.message : String(err)}). Search will use keywords.`
      console.warn(`[documents] ${note}`)
    }
  } else {
    note = 'Stored without embeddings (no NVIDIA_API_KEY). Search will use keywords.'
  }

  const indexedAs = vectors ? 'embedded' : 'keyword'
  db.saveChunks(
    doc.id,
    userId,
    pieces.map((text, i) => ({ text, embedding: vectors ? toBlob(vectors[i]) : null })),
    indexedAs
  )
  return { id: doc.id, name: doc.name, chunks: pieces.length, indexedAs, ...(note ? { note } : {}) }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export interface Passage {
  docId: number
  docName: string
  ordinal: number
  text: string
  score: number
}

const STOP = new Set(
  'the a an and or but if then than that this these those of in on at to for with from by is are was were be been being it its as i my me we our you your he she they them do does did not no so can could should would will just about into over under more most other some such only own same too very'.split(' ')
)
const tokenize = (s: string) =>
  s.toLowerCase().match(/[a-z0-9']{3,}/g)?.filter((t) => !STOP.has(t)) ?? []

/** Keyword overlap, used when there are no vectors to compare. */
function keywordScore(query: string, text: string): number {
  const q = new Set(tokenize(query))
  if (!q.size) return 0
  const words = tokenize(text)
  if (!words.length) return 0
  let hits = 0
  for (const w of words) if (q.has(w)) hits++
  // Normalize by length so a long chunk doesn't win by sheer volume.
  return hits / Math.sqrt(words.length)
}

/**
 * The passages most relevant to `goal`. The floor matters: an irrelevant
 * passage injected as context is worse than none, because the model will try
 * to use it.
 */
export async function retrieve(userId: number, goal: string, limit = 4): Promise<Passage[]> {
  const rows = db.chunksForUser(userId)
  if (!rows.length) return []

  const embedded = rows.filter((r) => r.embedding)
  let scored: Passage[]

  if (embedded.length && embeddingsConfigured()) {
    try {
      const [queryVector] = await embed([goal], 'query')
      scored = embedded.map((r) => ({
        docId: r.doc_id,
        docName: r.doc_name,
        ordinal: r.ordinal,
        text: r.text,
        score: cosine(queryVector, fromBlob(r.embedding!)),
      }))
      // Measured against nemotron-3-embed-1b on 2026-09-12 with a real
      // syllabus: correct matches scored 0.15–0.43, unrelated passages ≤0.03
      // (an off-topic question topped out at 0.003). This model's scale runs
      // much lower than the 0.7-ish people expect, so a textbook threshold
      // rejects everything; the gap to noise is what makes 0.1 safe.
      // Re-measure if the model changes.
      return scored
        .filter((p) => p.score >= RELEVANCE_FLOOR)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    } catch (err) {
      console.warn('[documents] embedding search failed, falling back to keywords:', err)
    }
  }

  scored = rows.map((r) => ({
    docId: r.doc_id,
    docName: r.doc_name,
    ordinal: r.ordinal,
    text: r.text,
    score: keywordScore(goal, r.text),
  }))
  return scored
    .filter((p) => p.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Format retrieved passages for the prompt, with names the model can cite. */
export function passageBlock(passages: Passage[]): string {
  if (!passages.length) return ''
  const body = passages
    .map((p, i) => `[${i + 1}] From "${p.docName}":\n${p.text}`)
    .join('\n\n')
  return `\n\nThe user has uploaded documents. These passages are the relevant parts — treat them as authoritative about the user's own situation, and cite the document name when you rely on one:\n\n${body}`
}

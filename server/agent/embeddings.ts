// ── Embeddings ────────────────────────────────────────────────────────────────
// Used to search a customer's uploaded documents by meaning rather than by
// keyword. NVIDIA's embeddings endpoint is OpenAI-shaped but needs `input_type`
// ("passage" when storing, "query" when searching) — asymmetric models score
// noticeably worse without it.
//
// Model ids rot here exactly as they do for chat: of the seven embedding models
// in this account's catalog on 2026-09-12, six answered 404 or 410 and only
// nemotron-3-embed-1b served. Validate with a real call before changing it.

const MODEL = process.env.NVIDIA_EMBED_MODEL || 'nvidia/nemotron-3-embed-1b'
const ENDPOINT =
  process.env.NVIDIA_EMBED_ENDPOINT || 'https://integrate.api.nvidia.com/v1/embeddings'

/** How many texts to send per request — large batches time out on shared endpoints. */
const BATCH = 16

export const embeddingsConfigured = (): boolean => Boolean(process.env.NVIDIA_API_KEY)

export interface EmbedResult {
  vectors: Float32Array[]
  model: string
}

async function embedBatch(texts: string[], inputType: 'passage' | 'query'): Promise<Float32Array[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      input_type: inputType,
      encoding_format: 'float',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    data?: { embedding: number[]; index: number }[]
    detail?: string
    message?: string
  }
  if (!res.ok || !data.data?.length) {
    throw new Error(
      `Embeddings failed (${res.status}): ${String(data.detail ?? data.message ?? '').slice(0, 160)}`
    )
  }
  // The API may return items out of order; index puts them back.
  const out: Float32Array[] = new Array(texts.length)
  for (const item of data.data) out[item.index ?? 0] = Float32Array.from(item.embedding)
  return out
}

export async function embed(
  texts: string[],
  inputType: 'passage' | 'query' = 'passage'
): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH), inputType)))
  }
  return out
}

/** Vectors come back normalized, but a stray zero vector would divide by zero. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// SQLite has no vector type, so store the raw float buffer.
export const toBlob = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)
export const fromBlob = (b: Buffer): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

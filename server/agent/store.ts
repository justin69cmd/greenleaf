import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { RunRecord, RunSummary } from '../types.js'

// ── Persistent run history ────────────────────────────────────────────────────
// Every finished run is written as one JSON file so the user can reopen an
// answer, re-download its files, and so the memory layer has something to
// recall. An in-memory index mirrors the directory, keeping list/search cheap
// and keeping the app usable if the filesystem turns out to be read-only
// (which is how it behaves on a serverless host).

const RUNS_DIR = process.env.RUNS_DIR || path.resolve('./agent_runs')
const MAX_RUNS_PER_USER = 200

/** id -> record, newest first when listed. */
const index = new Map<string, RunRecord>()
let loaded = false
let diskOk = true

export function newRunId(): string {
  return crypto.randomBytes(9).toString('hex')
}

function fileFor(id: string): string {
  // Ids are generated here (hex only), but never trust one that arrived from
  // a request — strip anything that could walk out of the directory.
  return path.join(RUNS_DIR, `${id.replace(/[^a-z0-9]/gi, '')}.json`)
}

/** Load the run index from disk once, on first use. */
export async function initRunStore(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    await fs.mkdir(RUNS_DIR, { recursive: true })
    const files = await fs.readdir(RUNS_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(RUNS_DIR, file), 'utf8')
        const record = JSON.parse(raw) as RunRecord
        if (record?.id) index.set(record.id, record)
      } catch {
        /* skip an unreadable/corrupt run rather than failing boot */
      }
    }
    console.log(`📚 Run history: ${index.size} run(s) loaded from ${RUNS_DIR}`)
  } catch (err) {
    diskOk = false
    console.warn(`⚠️  Run history is memory-only (${RUNS_DIR} is not writable):`, (err as Error).message)
  }
}

export async function saveRun(record: RunRecord): Promise<void> {
  index.set(record.id, record)
  trimUser(record.user)
  if (!diskOk) return
  try {
    await fs.mkdir(RUNS_DIR, { recursive: true })
    await fs.writeFile(fileFor(record.id), JSON.stringify(record, null, 2), 'utf8')
  } catch (err) {
    diskOk = false
    console.warn('⚠️  Could not persist run to disk:', (err as Error).message)
  }
}

/** Keep the newest N runs per user so a long-lived server can't grow forever. */
function trimUser(user: string): void {
  const mine = [...index.values()].filter((r) => r.user === user).sort((a, b) => b.startedAt - a.startedAt)
  for (const stale of mine.slice(MAX_RUNS_PER_USER)) {
    index.delete(stale.id)
    if (diskOk) void fs.unlink(fileFor(stale.id)).catch(() => {})
  }
}

function toSummary(r: RunRecord): RunSummary {
  return {
    id: r.id,
    title: r.title,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    taskCount: r.tasks.length,
    totalTokens: r.usage?.totalTokens ?? 0,
    files: r.files,
  }
}

export function listRuns(user: string, limit = 50): RunSummary[] {
  return [...index.values()]
    .filter((r) => r.user === user)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map(toSummary)
}

/** Fetch one run, scoped to its owner so a guessed id leaks nothing. */
export function getRun(id: string, user: string): RunRecord | null {
  const record = index.get(id)
  return record && record.user === user ? record : null
}

export async function deleteRun(id: string, user: string): Promise<boolean> {
  const record = index.get(id)
  if (!record || record.user !== user) return false
  index.delete(id)
  if (diskOk) await fs.unlink(fileFor(id)).catch(() => {})
  return true
}

/** Every run belonging to a user, newest first — the corpus the memory recalls from. */
export function runsForUser(user: string): RunRecord[] {
  return [...index.values()].filter((r) => r.user === user).sort((a, b) => b.startedAt - a.startedAt)
}

import { AsyncLocalStorage } from 'async_hooks'
import crypto from 'crypto'
import path from 'path'

// ── Per-account workspaces ────────────────────────────────────────────────────
// Files the specialists save belong to the customer whose run produced them.
// Each account gets its own directory under agent_workspace, and the tools only
// ever see the directory of the run they are working for — the same
// AsyncLocalStorage trick as the usage meter, so concurrent runs for different
// customers can't read or overwrite each other's files.
//
// Directory names are a hash of the account email rather than the email itself,
// so a directory listing on the server doesn't double as a customer list.

const ROOT = path.resolve(process.env.WORKSPACE_DIR || './agent_workspace')

function accountDir(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)
}

/**
 * The workspace for a run. Signed-out runs get a throwaway directory of their
 * own: nobody can download from it later, but it keeps them out of every
 * account's files.
 */
export function workspaceFor(user: string | null, runId?: string): string {
  if (user) return path.join(ROOT, accountDir(user))
  return path.join(ROOT, '_guest', (runId ?? crypto.randomBytes(9).toString('hex')).replace(/[^a-z0-9]/gi, ''))
}

const store = new AsyncLocalStorage<string>()

/** Run `fn` with `dir` as the workspace for every tool call it makes. */
export function runInWorkspace<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  return store.run(dir, fn)
}

/**
 * The workspace of the run in progress. Throws outside a run rather than
 * falling back to a shared directory — a tool with no owner must not write.
 */
export function currentWorkspace(): string {
  const dir = store.getStore()
  if (!dir) throw new Error('No workspace: file tools can only run inside an agent run.')
  return dir
}

/** Resolve `rel` inside `base`, or null if it points outside it (or at `base` itself). */
export function resolveInside(base: string, rel: string): string | null {
  const resolved = path.resolve(base, String(rel ?? '').replace(/^[/\\]+/, ''))
  return resolved.startsWith(base + path.sep) ? resolved : null
}

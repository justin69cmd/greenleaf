import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ── run_code sandbox ──────────────────────────────────────────────────────────
// The code is written by a model, and the model reads web pages anyone can
// write, so it has to be treated as hostile. It runs in a separate Node process
// with Node's permission model switched on:
//
//   filesystem   read only its own temp directory, write nothing
//   processes    no child processes, workers, native addons or inspector
//   environment  empty — no API keys, no SMTP password, no database path
//   network      fetch/WebSocket removed and the network modules refuse to load
//   resources    10 s wall clock, 128 MB heap, 1 MB of output
//
// The filesystem and process limits are enforced by Node itself. The network
// block is a loader hook in the child (the permission model has no network
// switch on the Node versions we run), which is why the module list below is
// deny-by-name and includes `module` — so the code can't unregister the hook.
// Anything that needs real I/O has its own tool: read_file, call_api, read_url.

const TIMEOUT_MS = 10_000
const MAX_OUTPUT = 1024 * 1024

const GUARD = `
import { registerHooks } from 'node:module'
const BLOCKED = new Set(['net', 'tls', 'http', 'https', 'http2', 'dgram', 'dns', 'child_process',
  'worker_threads', 'cluster', 'inspector', 'vm', 'wasi', 'module', 'repl', 'trace_events'])
const bare = (id) => String(id).replace(/^node:/, '').split('/')[0]
const refuse = (id) => new Error('run_code: "' + id + '" is not available in the sandbox. Use call_api or read_url for network access.')
registerHooks({
  resolve(specifier, context, next) {
    if (BLOCKED.has(bare(specifier))) throw refuse(specifier)
    return next(specifier, context)
  },
})
const getBuiltin = process.getBuiltinModule
if (getBuiltin) process.getBuiltinModule = (id) => { if (BLOCKED.has(bare(id))) throw refuse(id); return getBuiltin(id) }
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) delete globalThis[name]
`

let support: Promise<string | null> | null = null

/**
 * Whether this Node can sandbox at all: it needs the stable permission flag and
 * synchronous module hooks (Node 22.15+ / 23.5+). Returns why not, or null.
 * Checked once — an unsandboxed fallback is deliberately not offered.
 */
function sandboxUnavailable(): Promise<string | null> {
  support ??= (async () => {
    const { registerHooks } = (await import('module')) as { registerHooks?: unknown }
    if (typeof registerHooks !== 'function') return `Node ${process.version} lacks module.registerHooks`
    try {
      await execFileAsync(process.execPath, ['--permission', '-e', '0'], { env: {}, timeout: 5_000 })
      return null
    } catch {
      return `Node ${process.version} does not support --permission`
    }
  })()
  return support
}

export interface SandboxResult {
  ok: boolean
  output: string
}

export async function runSandboxed(code: string): Promise<SandboxResult> {
  const unavailable = await sandboxUnavailable()
  if (unavailable) {
    return { ok: false, output: `run_code is disabled: the sandbox needs Node 22.15+ (${unavailable}).` }
  }

  // Real path: the permission model compares resolved paths, and the temp dir
  // is behind a symlink on macOS (/var → /private/var).
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'greenleaf-code-')))
  try {
    await fs.writeFile(path.join(dir, 'guard.mjs'), GUARD, 'utf8')
    await fs.writeFile(path.join(dir, 'main.mjs'), code, 'utf8')
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${dir}`,
        '--max-old-space-size=128',
        '--import',
        './guard.mjs',
        './main.mjs',
      ],
      { cwd: dir, env: {}, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT }
    )
    return { ok: true, output: stdout || stderr || '(no output)' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: string; message?: string }
    if (e.killed) return { ok: false, output: `Code was stopped after ${TIMEOUT_MS / 1000}s.` }
    if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, output: 'Code printed more than 1 MB of output.' }
    // Node prints the source line and a stack before the message; lead with the
    // error itself so the model reads the cause, not our guard's source.
    const text = (e.stderr || e.stdout || e.message || String(err)).split(dir).join('.')
    const cause = text.match(/^\w*Error\b.*$/m)?.[0]
    return { ok: false, output: (cause ? `${cause}\n\n${text}` : text).slice(0, 2000) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

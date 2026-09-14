import fs from 'fs'
import path from 'path'
import { createClient, type Client, type InArgs, type InStatement, type Row } from '@libsql/client'

// ── Customer database ─────────────────────────────────────────────────────────
// Everything the sign-in flow needs to remember lives here: the account itself,
// its recovery codes, the sessions handed out to it, in-flight sign-in
// challenges, and an audit trail of every attempt.
//
// It is SQLite either way, through libSQL:
//   TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) → a hosted Turso database. Every
//       server instance talks to the same one, which is what serverless needs:
//       a sign-in started on one Vercel instance must be finishable on another.
//   otherwise → a local file (data/greenleaf.db), for development.
//
// A local file on Vercel lives in that instance's /tmp and dies with it, so the
// server says so loudly at boot rather than letting sign-ins fail at random.
//
// Foreign keys are not relied on: over Turso's HTTP protocol a PRAGMA doesn't
// outlive its request, so every delete that should cascade does so explicitly.

const TURSO_URL = process.env.TURSO_DATABASE_URL?.trim()
const DB_FILE =
  process.env.DATABASE_FILE ??
  (process.env.VERCEL ? '/tmp/greenleaf.db' : path.resolve('./data/greenleaf.db'))

/** Where the data lives, for boot logs and the customers script. Never includes the token. */
export const location = TURSO_URL ? `Turso (${TURSO_URL.replace(/^[a-z]+:\/\//, '').split('/')[0]})` : DB_FILE

function open(): Client {
  if (TURSO_URL) {
    return createClient({ url: TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
  }
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
  return createClient({ url: `file:${DB_FILE}` })
}

const client = open()

export type Stage = 'email_otp' | 'totp'
export type Purpose = 'login' | 'signup'

export interface UserRow {
  id: number
  name: string
  email: string
  /** Null for accounts that only ever sign in with Google. */
  password_hash: string | null
  password_salt: string | null
  email_verified: number
  /** Google's stable user id ("sub"), set once an account is linked. */
  google_sub: string | null
  avatar_url: string | null
  /** Refresh token for calendar writes. Only present once explicitly granted. */
  google_refresh_token: string | null
  calendar_connected_at: string | null
  totp_secret: string | null
  pending_totp_secret: string | null
  totp_enabled: number
  created_at: string
  last_login_at: string | null
}

export interface ChallengeRow {
  id: string
  email: string
  name: string
  purpose: Purpose
  stage: Stage
  password: string | null
  otp_hash: string
  otp_expires: number
  otp_attempts: number
  otp_sent_at: number
  resends: number
  totp_attempts: number
  created_at: number
}

export interface LoginEventRow {
  id: number
  user_id: number | null
  email: string
  ip: string | null
  stage: string
  outcome: 'success' | 'failure'
  detail: string | null
  created_at: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  email               TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  -- Null for Google-only accounts: they have no password to hash.
  password_hash       TEXT,
  password_salt       TEXT,
  email_verified      INTEGER NOT NULL DEFAULT 0,
  google_sub          TEXT    UNIQUE,
  avatar_url          TEXT,
  -- Long-lived grant for writing to the customer's calendar, once they allow it.
  google_refresh_token TEXT,
  calendar_connected_at TEXT,
  totp_secret         TEXT,
  pending_totp_secret TEXT,
  totp_enabled        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at       TEXT
);

-- One row per unused recovery code; consuming a code deletes its row.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  created_at TEXT   NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);

-- Sessions are stored as a hash of the bearer token, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- A sign-in in progress: which layers are cleared, and the hashed email code.
CREATE TABLE IF NOT EXISTS login_challenges (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  purpose       TEXT    NOT NULL,
  stage         TEXT    NOT NULL,
  password      TEXT,
  otp_hash      TEXT    NOT NULL,
  otp_expires   INTEGER NOT NULL,
  otp_attempts  INTEGER NOT NULL DEFAULT 0,
  otp_sent_at   INTEGER NOT NULL,
  resends       INTEGER NOT NULL DEFAULT 0,
  totp_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- A Google sign-in that has left for Google but not come back yet.
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_url    TEXT NOT NULL,
  purpose       TEXT NOT NULL DEFAULT 'signin',
  created_at    INTEGER NOT NULL
);

-- One-time code handed to the app after Google returns, swapped for the
-- session (or for the remaining authenticator step) by a POST it makes itself.
-- Keeps session tokens out of the URL bar and out of browser history.
CREATE TABLE IF NOT EXISTS auth_handoffs (
  code       TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A run published behind a link. Deleting the row revokes the link.
CREATE TABLE IF NOT EXISTS shared_runs (
  token        TEXT    PRIMARY KEY,
  run_id       TEXT    NOT NULL,
  owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  views        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_run ON shared_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_shared_owner ON shared_runs(owner_id);

-- Comments left by whoever opened a shared link.
CREATE TABLE IF NOT EXISTS run_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL REFERENCES shared_runs(token) ON DELETE CASCADE,
  author     TEXT    NOT NULL,
  /** Set when the commenter was signed in, so the owner can trust the name. */
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_token ON run_comments(token, id);

-- A recurring run. The cadence is stored in the customer's own local time, so
-- "8pm Sunday" stays 8pm Sunday across daylight-saving changes.
CREATE TABLE IF NOT EXISTS schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  goal         TEXT    NOT NULL,
  cadence      TEXT    NOT NULL,          -- daily | weekdays | weekly
  weekday      INTEGER,                   -- 0=Sunday, for cadence 'weekly'
  hour         INTEGER NOT NULL,
  minute       INTEGER NOT NULL DEFAULT 0,
  timezone     TEXT    NOT NULL DEFAULT 'UTC',
  delivery     TEXT    NOT NULL DEFAULT 'email',
  email        TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  /** Local YYYY-MM-DD of the last fire, so a schedule runs at most once a day. */
  last_fired_on TEXT,
  last_run_id  TEXT,
  last_status  TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);

-- A document the customer uploaded, so plans can be grounded in their own
-- material (a syllabus, a reading list, meeting notes).
CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  chars      INTEGER NOT NULL,
  chunks     INTEGER NOT NULL DEFAULT 0,
  /** 'embedded' when vectors exist, 'keyword' when the embedder was unavailable. */
  indexed_as TEXT    NOT NULL DEFAULT 'keyword',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

-- One passage of a document, with its vector. SQLite has no vector type, so
-- the embedding is the raw float32 buffer; similarity is computed in process.
CREATE TABLE IF NOT EXISTS doc_chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,
  text       TEXT    NOT NULL,
  embedding  BLOB
);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON doc_chunks(user_id);

-- Audit trail: every attempt at every layer, successful or not.
CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT    NOT NULL,
  ip         TEXT,
  stage      TEXT    NOT NULL,
  outcome    TEXT    NOT NULL,
  detail     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON login_events(user_id, id DESC);
`

/** Columns added after a table first shipped. SQLite can append nullable ones. */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  // Calendar write-back: the long-lived grant, and when it was given.
  ['users', 'google_refresh_token', 'TEXT'],
  ['users', 'calendar_connected_at', 'TEXT'],
  // What a round trip to Google was for: signing in, or asking for calendar access.
  ['oauth_states', 'purpose', "TEXT NOT NULL DEFAULT 'signin'"],
]

// Schema and migrations run once, before the first query. Every helper awaits
// this, so callers never see a half-initialised database. A failure is not
// cached: if Turso is unreachable for a moment at boot, the next request tries
// again instead of the instance being dead until it is recycled.
let initialising: Promise<void> | null = null

async function init(): Promise<void> {
  if (!TURSO_URL) {
    // Local file only: wait for a lock rather than failing (two dev servers on one file).
    await client.execute('PRAGMA busy_timeout = 5000')
    await client.execute('PRAGMA journal_mode = WAL')
  }
  await client.executeMultiple(SCHEMA)
  await migrate()
  console.log(`🗄️  Customer database: ${location}`)
  if (!TURSO_URL && process.env.VERCEL) {
    console.error(
      '🗄️  DATABASE NOT SHARED — this is a per-instance file in /tmp. Sign-ins will fail at random ' +
        'and accounts will disappear. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.'
    )
  }
}

/** Resolves once the schema is in place; rejects if the database can't be reached. */
export function dbReady(): Promise<void> {
  initialising ??= init().catch((err) => {
    initialising = null
    throw err
  })
  return initialising
}

// libSQL rows carry column names as enumerable keys; BLOBs arrive as
// ArrayBuffer, and the rest of the app expects Buffer.
function plain<T>(row: Row): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof ArrayBuffer ? Buffer.from(value) : value
  }
  return out as T
}

/**
 * A database that can't be reached surfaces as a network error ("fetch failed").
 * Callers show error messages to customers, so log the real cause and hand back
 * a sentence. SQL errors (a constraint, a typo) pass through untouched.
 */
function friendly(err: unknown): Error {
  const code = (err as { code?: string })?.code ?? ''
  if (err instanceof Error && (code.startsWith('SQLITE_') || code === 'SQL_INPUT_ERROR')) return err
  console.error(`[db] ${location} unreachable:`, err)
  return new Error('Our account service is unavailable right now. Please try again in a moment.')
}

async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
  try {
    await dbReady()
    const result = await client.execute({ sql, args })
    return result.rows.map((r) => plain<T>(r))
  } catch (err) {
    throw friendly(err)
  }
}

async function get<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0]
}

/** Run a write; resolves to the number of rows it changed. */
async function run(sql: string, args: InArgs = []): Promise<number> {
  try {
    await dbReady()
    return (await client.execute({ sql, args })).rowsAffected
  } catch (err) {
    throw friendly(err)
  }
}

/** Several statements, atomically, in one round trip. */
async function atomically(statements: InStatement[]) {
  try {
    await dbReady()
    return await client.batch(statements, 'write')
  } catch (err) {
    throw friendly(err)
  }
}

async function addMissingColumns(): Promise<void> {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const columns = (await client.execute(`PRAGMA table_info('${table}')`)).rows
    if (columns.length === 0 || columns.some((c) => c.name === column)) continue
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    console.log(`🗄️  Added ${table}.${column}`)
  }
}

// Bring a database created before Google sign-in up to the current shape.
// SQLite cannot relax a NOT NULL in place, so the users table is rebuilt.
async function migrate(): Promise<void> {
  await addMissingColumns()
  const columns = (await client.execute("PRAGMA table_info('users')")).rows
  if (columns.some((c) => c.name === 'google_sub')) return

  await client.batch(
    [
      `CREATE TABLE users_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT    NOT NULL,
        email               TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash       TEXT,
        password_salt       TEXT,
        email_verified      INTEGER NOT NULL DEFAULT 0,
        google_sub          TEXT    UNIQUE,
        avatar_url          TEXT,
        google_refresh_token TEXT,
        calendar_connected_at TEXT,
        totp_secret         TEXT,
        pending_totp_secret TEXT,
        totp_enabled        INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        last_login_at       TEXT
      )`,
      `INSERT INTO users_new
        (id, name, email, password_hash, password_salt, email_verified,
         totp_secret, pending_totp_secret, totp_enabled, created_at, last_login_at)
        SELECT id, name, email, password_hash, password_salt, email_verified,
               totp_secret, pending_totp_secret, totp_enabled, created_at, last_login_at
          FROM users`,
      'DROP TABLE users',
      'ALTER TABLE users_new RENAME TO users',
    ],
    'write'
  )
  console.log('🗄️  Migrated users table for Google sign-in')
}

/** Escape hatch for one-off read queries and scripts. */
export function query<T>(sql: string, args: InArgs = []): Promise<T[]> {
  return all<T>(sql, args)
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export function findUser(email: string): Promise<UserRow | undefined> {
  return get<UserRow>('SELECT * FROM users WHERE email = ?', [email])
}

export function findUserById(id: number): Promise<UserRow | undefined> {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
}

export async function createUser(input: {
  name: string
  email: string
  passwordHash?: string | null
  passwordSalt?: string | null
  emailVerified: boolean
  googleSub?: string | null
  avatarUrl?: string | null
}): Promise<UserRow> {
  const row = await get<UserRow>(
    `INSERT INTO users
       (name, email, password_hash, password_salt, email_verified, google_sub, avatar_url)
     VALUES
       (@name, @email, @passwordHash, @passwordSalt, @emailVerified, @googleSub, @avatarUrl)
     RETURNING *`,
    {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash ?? null,
      passwordSalt: input.passwordSalt ?? null,
      emailVerified: input.emailVerified ? 1 : 0,
      googleSub: input.googleSub ?? null,
      avatarUrl: input.avatarUrl ?? null,
    }
  )
  return row!
}

/** Look an account up by the Google id it was linked with. */
export function findUserByGoogleSub(sub: string): Promise<UserRow | undefined> {
  return get<UserRow>('SELECT * FROM users WHERE google_sub = ?', [sub])
}

/** Attach a Google identity to an existing account (same verified email). */
export async function linkGoogleAccount(
  userId: number,
  googleSub: string,
  avatarUrl?: string | null
): Promise<void> {
  await run(
    `UPDATE users
        SET google_sub = ?, avatar_url = COALESCE(?, avatar_url), email_verified = 1
      WHERE id = ?`,
    [googleSub, avatarUrl ?? null, userId]
  )
}

export async function markEmailVerified(userId: number): Promise<void> {
  await run('UPDATE users SET email_verified = 1 WHERE id = ?', [userId])
}

export async function touchLastLogin(userId: number): Promise<void> {
  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [userId])
}

export async function setPendingTotpSecret(userId: number, secret: string | null): Promise<void> {
  await run('UPDATE users SET pending_totp_secret = ? WHERE id = ?', [secret, userId])
}

/** Confirm enrolment: promote the pending secret and replace the recovery codes. */
export async function enableTotpForUser(userId: number, secret: string, codeHashes: string[]): Promise<void> {
  await atomically([
    {
      sql: `UPDATE users
               SET totp_secret = ?, pending_totp_secret = NULL, totp_enabled = 1
             WHERE id = ?`,
      args: [secret, userId],
    },
    { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', args: [userId] },
    ...codeHashes.map((hash) => ({
      sql: 'INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)',
      args: [userId, hash],
    })),
  ])
}

export async function disableTotpForUser(userId: number): Promise<void> {
  await atomically([
    {
      sql: `UPDATE users
               SET totp_secret = NULL, pending_totp_secret = NULL, totp_enabled = 0
             WHERE id = ?`,
      args: [userId],
    },
    { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', args: [userId] },
  ])
}

// ── Recovery codes ────────────────────────────────────────────────────────────

export async function countRecoveryCodes(userId: number): Promise<number> {
  const row = await get<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?', [userId])
  return row?.n ?? 0
}

/** Burn a recovery code. Returns false if it was never issued or already used. */
export async function consumeRecoveryCode(userId: number, codeHash: string): Promise<boolean> {
  return (await run('DELETE FROM recovery_codes WHERE user_id = ? AND code_hash = ?', [userId, codeHash])) > 0
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(userId: number, tokenHash: string, ttlMs: number): Promise<void> {
  const now = Date.now()
  await run(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, userId, now, now + ttlMs, now]
  )
}

/** Resolve a session token hash to its account email, refreshing last_seen_at. */
export async function emailForSession(tokenHash: string): Promise<string | null> {
  // Every signed-in request lands here, so it is one round trip: refresh a live
  // session and read it back together.
  const now = Date.now()
  const [, lookup] = await atomically([
    { sql: 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND expires_at >= ?', args: [now, tokenHash, now] },
    {
      sql: `SELECT u.email AS email, s.expires_at AS expires_at
              FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?`,
      args: [tokenHash],
    },
  ])
  const row = lookup.rows[0]
  if (!row) return null
  if (Number(row.expires_at) < now) {
    await deleteSession(tokenHash)
    return null
  }
  return String(row.email)
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash])
}

/** Sign every device out — used when the second factor changes. */
export async function deleteSessionsForUser(userId: number, except?: string): Promise<void> {
  if (except) {
    await run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [userId, except])
  } else {
    await run('DELETE FROM sessions WHERE user_id = ?', [userId])
  }
}

// ── Sign-in challenges ────────────────────────────────────────────────────────

export async function saveChallenge(row: ChallengeRow): Promise<void> {
  await run(
    `INSERT INTO login_challenges
       (id, email, name, purpose, stage, password, otp_hash, otp_expires,
        otp_attempts, otp_sent_at, resends, totp_attempts, created_at)
     VALUES
       (@id, @email, @name, @purpose, @stage, @password, @otp_hash, @otp_expires,
        @otp_attempts, @otp_sent_at, @resends, @totp_attempts, @created_at)
     ON CONFLICT(id) DO UPDATE SET
        stage = excluded.stage,
        password = excluded.password,
        otp_hash = excluded.otp_hash,
        otp_expires = excluded.otp_expires,
        otp_attempts = excluded.otp_attempts,
        otp_sent_at = excluded.otp_sent_at,
        resends = excluded.resends,
        totp_attempts = excluded.totp_attempts`,
    { ...row }
  )
}

export function findChallenge(id: string): Promise<ChallengeRow | undefined> {
  return get<ChallengeRow>('SELECT * FROM login_challenges WHERE id = ?', [id])
}

export async function deleteChallenge(id: string): Promise<void> {
  await run('DELETE FROM login_challenges WHERE id = ?', [id])
}

/** Drop expired challenges and sessions. Cheap enough to call on every attempt. */
export async function sweep(challengeTtlMs: number): Promise<void> {
  const now = Date.now()
  await atomically([
    { sql: 'DELETE FROM login_challenges WHERE created_at < ?', args: [now - challengeTtlMs] },
    { sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [now] },
    // A trip to Google and back is seconds; a handoff is swapped immediately.
    { sql: 'DELETE FROM oauth_states WHERE created_at < ?', args: [now - 10 * 60_000] },
    { sql: 'DELETE FROM auth_handoffs WHERE created_at < ?', args: [now - 2 * 60_000] },
  ])
}

// ── Google sign-in: round-trip state and one-time handoffs ───────────────────

export async function saveOAuthState(
  state: string,
  codeVerifier: string,
  returnUrl: string,
  purpose: 'signin' | 'calendar' = 'signin'
): Promise<void> {
  await run(
    'INSERT INTO oauth_states (state, code_verifier, return_url, purpose, created_at) VALUES (?, ?, ?, ?, ?)',
    [state, codeVerifier, returnUrl, purpose, Date.now()]
  )
}

/**
 * Read a state and delete it in one statement — a state is good for exactly one
 * callback, even when two instances receive the same callback at once.
 */
export function takeOAuthState(
  state: string
): Promise<{ code_verifier: string; return_url: string; purpose: string; created_at: number } | undefined> {
  return get('DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, return_url, purpose, created_at', [
    state,
  ])
}

export async function saveHandoff(code: string, payload: unknown): Promise<void> {
  await run('INSERT INTO auth_handoffs (code, payload, created_at) VALUES (?, ?, ?)', [
    code,
    JSON.stringify(payload),
    Date.now(),
  ])
}

/** Single use: the row is deleted as it is read. */
export function takeHandoff(code: string): Promise<{ payload: string; created_at: number } | undefined> {
  return get('DELETE FROM auth_handoffs WHERE code = ? RETURNING payload, created_at', [code])
}

// ── Sharing ───────────────────────────────────────────────────────────────────

export interface SharedRunRow {
  token: string
  run_id: string
  owner_id: number
  title: string
  allow_comments: number
  views: number
  created_at: number
}

export interface CommentRow {
  id: number
  token: string
  author: string
  user_id: number | null
  body: string
  created_at: number
}

export async function createShare(input: {
  token: string
  runId: string
  ownerId: number
  title: string
  allowComments: boolean
}): Promise<SharedRunRow> {
  const row = await get<SharedRunRow>(
    `INSERT INTO shared_runs (token, run_id, owner_id, title, allow_comments, created_at)
     VALUES (@token, @runId, @ownerId, @title, @allowComments, @createdAt)
     ON CONFLICT(run_id) DO UPDATE SET
       allow_comments = excluded.allow_comments,
       title = excluded.title
     RETURNING *`,
    {
      token: input.token,
      runId: input.runId,
      ownerId: input.ownerId,
      title: input.title,
      allowComments: input.allowComments ? 1 : 0,
      createdAt: Date.now(),
    }
  )
  return row!
}

export function findShare(token: string): Promise<SharedRunRow | undefined> {
  return get<SharedRunRow>('SELECT * FROM shared_runs WHERE token = ?', [token])
}

export function findShareByRun(runId: string): Promise<SharedRunRow | undefined> {
  return get<SharedRunRow>('SELECT * FROM shared_runs WHERE run_id = ?', [runId])
}

export function listSharesForOwner(ownerId: number): Promise<SharedRunRow[]> {
  return all<SharedRunRow>('SELECT * FROM shared_runs WHERE owner_id = ? ORDER BY created_at DESC', [ownerId])
}

export async function deleteShare(runId: string, ownerId: number): Promise<boolean> {
  // Comments go with the link (explicitly — see the note on foreign keys).
  const [, removed] = await atomically([
    {
      sql: 'DELETE FROM run_comments WHERE token IN (SELECT token FROM shared_runs WHERE run_id = ? AND owner_id = ?)',
      args: [runId, ownerId],
    },
    { sql: 'DELETE FROM shared_runs WHERE run_id = ? AND owner_id = ?', args: [runId, ownerId] },
  ])
  return removed.rowsAffected > 0
}

export async function countShareView(token: string): Promise<void> {
  await run('UPDATE shared_runs SET views = views + 1 WHERE token = ?', [token])
}

export async function addComment(input: {
  token: string
  author: string
  userId?: number | null
  body: string
}): Promise<CommentRow> {
  const row = await get<CommentRow>(
    `INSERT INTO run_comments (token, author, user_id, body, created_at)
     VALUES (@token, @author, @userId, @body, @createdAt)
     RETURNING *`,
    {
      token: input.token,
      author: input.author,
      userId: input.userId ?? null,
      body: input.body,
      createdAt: Date.now(),
    }
  )
  return row!
}

export function listComments(token: string): Promise<CommentRow[]> {
  return all<CommentRow>('SELECT * FROM run_comments WHERE token = ? ORDER BY id', [token])
}

export async function deleteComment(id: number, ownerId: number): Promise<boolean> {
  // Only the run's owner can remove a comment from their shared run.
  const changed = await run(
    `DELETE FROM run_comments
      WHERE id = ? AND token IN (SELECT token FROM shared_runs WHERE owner_id = ?)`,
    [id, ownerId]
  )
  return changed > 0
}

/** Store the long-lived calendar grant. Google only sends it on first consent. */
export async function saveCalendarGrant(userId: number, refreshToken: string): Promise<void> {
  await run("UPDATE users SET google_refresh_token = ?, calendar_connected_at = datetime('now') WHERE id = ?", [
    refreshToken,
    userId,
  ])
}

export async function revokeCalendarGrant(userId: number): Promise<void> {
  await run('UPDATE users SET google_refresh_token = NULL, calendar_connected_at = NULL WHERE id = ?', [userId])
}

// ── Documents ─────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: number
  user_id: number
  name: string
  kind: string
  chars: number
  chunks: number
  indexed_as: string
  created_at: number
}

export interface ChunkRow {
  id: number
  doc_id: number
  user_id: number
  ordinal: number
  text: string
  embedding: Buffer | null
}

export async function createDocument(input: {
  userId: number
  name: string
  kind: string
  chars: number
}): Promise<DocumentRow> {
  const row = await get<DocumentRow>(
    `INSERT INTO documents (user_id, name, kind, chars, created_at)
     VALUES (@userId, @name, @kind, @chars, @createdAt)
     RETURNING *`,
    { ...input, createdAt: Date.now() }
  )
  return row!
}

// A large document is hundreds of passages, each with a vector; one batch of
// all of them can exceed what a single request to Turso should carry.
const CHUNK_BATCH = 50

/** Write a document's passages in one transaction — a half-indexed doc is worse than none. */
export async function saveChunks(
  docId: number,
  userId: number,
  chunks: { text: string; embedding: Buffer | null }[],
  indexedAs: 'embedded' | 'keyword'
): Promise<void> {
  await dbReady()
  const tx = await client.transaction('write')
  try {
    for (let start = 0; start < chunks.length; start += CHUNK_BATCH) {
      await tx.batch(
        chunks.slice(start, start + CHUNK_BATCH).map((c, i) => ({
          sql: 'INSERT INTO doc_chunks (doc_id, user_id, ordinal, text, embedding) VALUES (?, ?, ?, ?, ?)',
          args: [docId, userId, start + i, c.text, c.embedding],
        }))
      )
    }
    await tx.execute({
      sql: 'UPDATE documents SET chunks = ?, indexed_as = ? WHERE id = ?',
      args: [chunks.length, indexedAs, docId],
    })
    await tx.commit()
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  } finally {
    tx.close()
  }
}

export function listDocuments(userId: number): Promise<DocumentRow[]> {
  return all<DocumentRow>('SELECT * FROM documents WHERE user_id = ? ORDER BY id DESC', [userId])
}

export async function deleteDocument(id: number, userId: number): Promise<boolean> {
  const [, removed] = await atomically([
    { sql: 'DELETE FROM doc_chunks WHERE doc_id = ? AND user_id = ?', args: [id, userId] },
    { sql: 'DELETE FROM documents WHERE id = ? AND user_id = ?', args: [id, userId] },
  ])
  return removed.rowsAffected > 0
}

/** Every passage this account owns, with its document's name. */
export function chunksForUser(userId: number): Promise<(ChunkRow & { doc_name: string })[]> {
  return all<ChunkRow & { doc_name: string }>(
    `SELECT c.*, d.name AS doc_name
       FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
      WHERE c.user_id = ?`,
    [userId]
  )
}

export async function countDocuments(userId: number): Promise<number> {
  return (await get<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE user_id = ?', [userId]))?.n ?? 0
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export interface ScheduleRow {
  id: number
  user_id: number
  title: string
  goal: string
  cadence: 'daily' | 'weekdays' | 'weekly'
  weekday: number | null
  hour: number
  minute: number
  timezone: string
  delivery: 'screen' | 'email'
  email: string
  enabled: number
  last_fired_on: string | null
  last_run_id: string | null
  last_status: string | null
  created_at: number
}

export async function createSchedule(input: {
  userId: number
  title: string
  goal: string
  cadence: string
  weekday: number | null
  hour: number
  minute: number
  timezone: string
  delivery: string
  email: string
}): Promise<ScheduleRow> {
  const row = await get<ScheduleRow>(
    `INSERT INTO schedules
       (user_id, title, goal, cadence, weekday, hour, minute, timezone, delivery, email, created_at)
     VALUES
       (@userId, @title, @goal, @cadence, @weekday, @hour, @minute, @timezone, @delivery, @email, @createdAt)
     RETURNING *`,
    { ...input, createdAt: Date.now() }
  )
  return row!
}

export function findSchedule(id: number): Promise<ScheduleRow | undefined> {
  return get<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', [id])
}

export function listSchedules(userId: number): Promise<ScheduleRow[]> {
  return all<ScheduleRow>('SELECT * FROM schedules WHERE user_id = ? ORDER BY id', [userId])
}

/** Every schedule that could fire, across all accounts — the runner's input. */
export function allEnabledSchedules(): Promise<ScheduleRow[]> {
  return all<ScheduleRow>('SELECT * FROM schedules WHERE enabled = 1')
}

export async function setScheduleEnabled(id: number, userId: number, enabled: boolean): Promise<boolean> {
  return (await run('UPDATE schedules SET enabled = ? WHERE id = ? AND user_id = ?', [enabled ? 1 : 0, id, userId])) > 0
}

export async function deleteSchedule(id: number, userId: number): Promise<boolean> {
  return (await run('DELETE FROM schedules WHERE id = ? AND user_id = ?', [id, userId])) > 0
}

/** Record the outcome of a fire, and the local date that claimed it. */
export async function markScheduleFired(
  id: number,
  localDate: string,
  runId: string | null,
  status: string
): Promise<void> {
  await run('UPDATE schedules SET last_fired_on = ?, last_run_id = ?, last_status = ? WHERE id = ?', [
    localDate,
    runId,
    status,
    id,
  ])
}

// ── Audit trail ───────────────────────────────────────────────────────────────

export async function recordLoginEvent(event: {
  userId?: number | null
  email: string
  ip?: string | null
  stage: string
  outcome: 'success' | 'failure'
  detail?: string | null
}): Promise<void> {
  await run(
    `INSERT INTO login_events (user_id, email, ip, stage, outcome, detail)
     VALUES (@userId, @email, @ip, @stage, @outcome, @detail)`,
    {
      userId: event.userId ?? null,
      email: event.email,
      ip: event.ip ?? null,
      stage: event.stage,
      outcome: event.outcome,
      detail: event.detail ?? null,
    }
  )
}

export function recentLoginEvents(userId: number, limit = 10): Promise<LoginEventRow[]> {
  return all<LoginEventRow>('SELECT * FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit])
}

// ── One-time import of the old users.json ─────────────────────────────────────
// Accounts created before the database existed are copied in on first boot, and
// the file is renamed so it never runs twice.

export async function importLegacyUsers(file: string): Promise<void> {
  if (!fs.existsSync(file)) return
  try {
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      {
        name?: string
        email?: string
        salt?: string
        hash?: string
        emailVerified?: boolean
        totpSecret?: string
        totpEnabled?: boolean
        recoveryCodes?: string[]
      }
    >
    let imported = 0
    for (const [email, user] of Object.entries(legacy)) {
      if (!user?.salt || !user?.hash || (await findUser(email))) continue
      const row = await createUser({
        name: user.name || email.split('@')[0],
        email,
        passwordHash: user.hash,
        passwordSalt: user.salt,
        emailVerified: user.emailVerified ?? true,
      })
      if (user.totpEnabled && user.totpSecret) {
        await enableTotpForUser(row.id, user.totpSecret, user.recoveryCodes ?? [])
      }
      imported++
    }
    fs.renameSync(file, `${file}.migrated`)
    console.log(`🗄️  Imported ${imported} account(s) from ${file} — renamed to ${file}.migrated`)
  } catch (err) {
    console.warn(`[db] Could not import ${file}: ${String(err)}`)
  }
}

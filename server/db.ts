import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

// ── Customer database ─────────────────────────────────────────────────────────
// Everything the sign-in flow needs to remember lives here: the account itself,
// its recovery codes, the sessions handed out to it, in-flight sign-in
// challenges, and an audit trail of every attempt.
//
// SQLite because it needs no server of its own and the whole database is one
// file you can copy or open with any SQL tool. On a read-only host (serverless)
// we fall back to an in-memory database so the app still boots — accounts just
// won't survive the process.

// On Vercel the project directory is read-only and only /tmp is writable, so
// default there instead of falling all the way back to an in-memory database.
// Either way a serverless instance keeps its own copy: accounts written on one
// instance are not visible to the next. A host with a real disk (or Postgres)
// is what makes them stick.
const DB_FILE =
  process.env.DATABASE_FILE ??
  (process.env.VERCEL ? '/tmp/greenleaf.db' : path.resolve('./data/greenleaf.db'))

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

function open(): Database.Database {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
    const database = new Database(DB_FILE)
    console.log(`🗄️  Customer database: ${DB_FILE}`)
    return database
  } catch (err) {
    console.warn(`[db] ${DB_FILE} is not writable (${String(err)}) — using an in-memory database.`)
    return new Database(':memory:')
  }
}

const db = open()
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA)
migrate()

// Bring a database created before Google sign-in up to the current shape.
// SQLite cannot relax a NOT NULL in place, so the users table is rebuilt.
function migrate(): void {
  const columns = db.prepare("PRAGMA table_info('users')").all() as { name: string }[]
  if (columns.some((c) => c.name === 'google_sub')) return

  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT    NOT NULL,
        email               TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash       TEXT,
        password_salt       TEXT,
        email_verified      INTEGER NOT NULL DEFAULT 0,
        google_sub          TEXT    UNIQUE,
        avatar_url          TEXT,
        totp_secret         TEXT,
        pending_totp_secret TEXT,
        totp_enabled        INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        last_login_at       TEXT
      );
      INSERT INTO users_new
        (id, name, email, password_hash, password_salt, email_verified,
         totp_secret, pending_totp_secret, totp_enabled, created_at, last_login_at)
        SELECT id, name, email, password_hash, password_salt, email_verified,
               totp_secret, pending_totp_secret, totp_enabled, created_at, last_login_at
          FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `)
  })()
  db.pragma('foreign_keys = ON')
  console.log('🗄️  Migrated users table for Google sign-in')
}

/** Escape hatch for one-off queries and tests. */
export function raw(): Database.Database {
  return db
}

// ── Accounts ──────────────────────────────────────────────────────────────────

const selectUserByEmail = db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?')
const selectUserById = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?')

export function findUser(email: string): UserRow | undefined {
  return selectUserByEmail.get(email)
}

export function findUserById(id: number): UserRow | undefined {
  return selectUserById.get(id)
}

export function createUser(input: {
  name: string
  email: string
  passwordHash?: string | null
  passwordSalt?: string | null
  emailVerified: boolean
  googleSub?: string | null
  avatarUrl?: string | null
}): UserRow {
  const info = db
    .prepare(
      `INSERT INTO users
         (name, email, password_hash, password_salt, email_verified, google_sub, avatar_url)
       VALUES
         (@name, @email, @passwordHash, @passwordSalt, @emailVerified, @googleSub, @avatarUrl)`
    )
    .run({
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash ?? null,
      passwordSalt: input.passwordSalt ?? null,
      emailVerified: input.emailVerified ? 1 : 0,
      googleSub: input.googleSub ?? null,
      avatarUrl: input.avatarUrl ?? null,
    })
  return selectUserById.get(Number(info.lastInsertRowid))!
}

/** Look an account up by the Google id it was linked with. */
export function findUserByGoogleSub(sub: string): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE google_sub = ?').get(sub)
}

/** Attach a Google identity to an existing account (same verified email). */
export function linkGoogleAccount(
  userId: number,
  googleSub: string,
  avatarUrl?: string | null
): void {
  db.prepare(
    `UPDATE users
        SET google_sub = ?, avatar_url = COALESCE(?, avatar_url), email_verified = 1
      WHERE id = ?`
  ).run(googleSub, avatarUrl ?? null, userId)
}

export function markEmailVerified(userId: number): void {
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId)
}

export function touchLastLogin(userId: number): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId)
}

export function setPendingTotpSecret(userId: number, secret: string | null): void {
  db.prepare('UPDATE users SET pending_totp_secret = ? WHERE id = ?').run(secret, userId)
}

/** Confirm enrolment: promote the pending secret and replace the recovery codes. */
export const enableTotpForUser = db.transaction(
  (userId: number, secret: string, codeHashes: string[]) => {
    db.prepare(
      `UPDATE users
          SET totp_secret = ?, pending_totp_secret = NULL, totp_enabled = 1
        WHERE id = ?`
    ).run(secret, userId)
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
    const insert = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)')
    for (const hash of codeHashes) insert.run(userId, hash)
  }
)

export const disableTotpForUser = db.transaction((userId: number) => {
  db.prepare(
    `UPDATE users
        SET totp_secret = NULL, pending_totp_secret = NULL, totp_enabled = 0
      WHERE id = ?`
  ).run(userId)
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
})

// ── Recovery codes ────────────────────────────────────────────────────────────

export function countRecoveryCodes(userId: number): number {
  const row = db
    .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?')
    .get(userId)
  return row?.n ?? 0
}

/** Burn a recovery code. Returns false if it was never issued or already used. */
export function consumeRecoveryCode(userId: number, codeHash: string): boolean {
  const info = db
    .prepare('DELETE FROM recovery_codes WHERE user_id = ? AND code_hash = ?')
    .run(userId, codeHash)
  return info.changes > 0
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function createSession(userId: number, tokenHash: string, ttlMs: number): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, userId, now, now + ttlMs, now)
}

/** Resolve a session token hash to its account email, refreshing last_seen_at. */
export function emailForSession(tokenHash: string): string | null {
  const row = db
    .prepare<[string], { email: string; expires_at: number }>(
      `SELECT u.email AS email, s.expires_at AS expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(tokenHash)
  if (!row) return null
  if (row.expires_at < Date.now()) {
    deleteSession(tokenHash)
    return null
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash)
  return row.email
}

export function deleteSession(tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

/** Sign every device out — used when the second factor changes. */
export function deleteSessionsForUser(userId: number, except?: string): void {
  if (except) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, except)
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }
}

// ── Sign-in challenges ────────────────────────────────────────────────────────

export function saveChallenge(row: ChallengeRow): void {
  db.prepare(
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
        totp_attempts = excluded.totp_attempts`
  ).run(row)
}

export function findChallenge(id: string): ChallengeRow | undefined {
  return db.prepare<[string], ChallengeRow>('SELECT * FROM login_challenges WHERE id = ?').get(id)
}

export function deleteChallenge(id: string): void {
  db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id)
}

/** Drop expired challenges and sessions. Cheap enough to call on every attempt. */
export function sweep(challengeTtlMs: number): void {
  const now = Date.now()
  db.prepare('DELETE FROM login_challenges WHERE created_at < ?').run(now - challengeTtlMs)
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  // A trip to Google and back is seconds; a handoff is swapped immediately.
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now - 10 * 60_000)
  db.prepare('DELETE FROM auth_handoffs WHERE created_at < ?').run(now - 2 * 60_000)
}

// ── Google sign-in: round-trip state and one-time handoffs ───────────────────

export function saveOAuthState(state: string, codeVerifier: string, returnUrl: string): void {
  db.prepare(
    'INSERT INTO oauth_states (state, code_verifier, return_url, created_at) VALUES (?, ?, ?, ?)'
  ).run(state, codeVerifier, returnUrl, Date.now())
}

/** Read a state and delete it in one go — a state is good for exactly one callback. */
export function takeOAuthState(
  state: string
): { code_verifier: string; return_url: string; created_at: number } | undefined {
  const row = db
    .prepare<[string], { code_verifier: string; return_url: string; created_at: number }>(
      'SELECT code_verifier, return_url, created_at FROM oauth_states WHERE state = ?'
    )
    .get(state)
  if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
  return row
}

export function saveHandoff(code: string, payload: unknown): void {
  db.prepare('INSERT INTO auth_handoffs (code, payload, created_at) VALUES (?, ?, ?)').run(
    code,
    JSON.stringify(payload),
    Date.now()
  )
}

/** Single use: the row is deleted as it is read. */
export function takeHandoff(code: string): { payload: string; created_at: number } | undefined {
  const row = db
    .prepare<[string], { payload: string; created_at: number }>(
      'SELECT payload, created_at FROM auth_handoffs WHERE code = ?'
    )
    .get(code)
  if (row) db.prepare('DELETE FROM auth_handoffs WHERE code = ?').run(code)
  return row
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

export function createShare(input: {
  token: string
  runId: string
  ownerId: number
  title: string
  allowComments: boolean
}): SharedRunRow {
  db.prepare(
    `INSERT INTO shared_runs (token, run_id, owner_id, title, allow_comments, created_at)
     VALUES (@token, @runId, @ownerId, @title, @allowComments, @createdAt)
     ON CONFLICT(run_id) DO UPDATE SET
       allow_comments = excluded.allow_comments,
       title = excluded.title`
  ).run({
    token: input.token,
    runId: input.runId,
    ownerId: input.ownerId,
    title: input.title,
    allowComments: input.allowComments ? 1 : 0,
    createdAt: Date.now(),
  })
  return findShareByRun(input.runId)!
}

export function findShare(token: string): SharedRunRow | undefined {
  return db.prepare<[string], SharedRunRow>('SELECT * FROM shared_runs WHERE token = ?').get(token)
}

export function findShareByRun(runId: string): SharedRunRow | undefined {
  return db.prepare<[string], SharedRunRow>('SELECT * FROM shared_runs WHERE run_id = ?').get(runId)
}

export function listSharesForOwner(ownerId: number): SharedRunRow[] {
  return db
    .prepare<[number], SharedRunRow>('SELECT * FROM shared_runs WHERE owner_id = ? ORDER BY created_at DESC')
    .all(ownerId)
}

export function deleteShare(runId: string, ownerId: number): boolean {
  return (
    db.prepare('DELETE FROM shared_runs WHERE run_id = ? AND owner_id = ?').run(runId, ownerId)
      .changes > 0
  )
}

export function countShareView(token: string): void {
  db.prepare('UPDATE shared_runs SET views = views + 1 WHERE token = ?').run(token)
}

export function addComment(input: {
  token: string
  author: string
  userId?: number | null
  body: string
}): CommentRow {
  const info = db
    .prepare(
      'INSERT INTO run_comments (token, author, user_id, body, created_at) VALUES (@token, @author, @userId, @body, @createdAt)'
    )
    .run({
      token: input.token,
      author: input.author,
      userId: input.userId ?? null,
      body: input.body,
      createdAt: Date.now(),
    })
  return db
    .prepare<[number], CommentRow>('SELECT * FROM run_comments WHERE id = ?')
    .get(Number(info.lastInsertRowid))!
}

export function listComments(token: string): CommentRow[] {
  return db
    .prepare<[string], CommentRow>('SELECT * FROM run_comments WHERE token = ? ORDER BY id')
    .all(token)
}

export function deleteComment(id: number, ownerId: number): boolean {
  // Only the run's owner can remove a comment from their shared run.
  return (
    db
      .prepare(
        `DELETE FROM run_comments
          WHERE id = ? AND token IN (SELECT token FROM shared_runs WHERE owner_id = ?)`
      )
      .run(id, ownerId).changes > 0
  )
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

export function createSchedule(input: {
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
}): ScheduleRow {
  const info = db
    .prepare(
      `INSERT INTO schedules
         (user_id, title, goal, cadence, weekday, hour, minute, timezone, delivery, email, created_at)
       VALUES
         (@userId, @title, @goal, @cadence, @weekday, @hour, @minute, @timezone, @delivery, @email, @createdAt)`
    )
    .run({ ...input, createdAt: Date.now() })
  return findSchedule(Number(info.lastInsertRowid))!
}

export function findSchedule(id: number): ScheduleRow | undefined {
  return db.prepare<[number], ScheduleRow>('SELECT * FROM schedules WHERE id = ?').get(id)
}

export function listSchedules(userId: number): ScheduleRow[] {
  return db
    .prepare<[number], ScheduleRow>('SELECT * FROM schedules WHERE user_id = ? ORDER BY id')
    .all(userId)
}

/** Every schedule that could fire, across all accounts — the runner's input. */
export function allEnabledSchedules(): ScheduleRow[] {
  return db.prepare<[], ScheduleRow>('SELECT * FROM schedules WHERE enabled = 1').all()
}

export function setScheduleEnabled(id: number, userId: number, enabled: boolean): boolean {
  return (
    db
      .prepare('UPDATE schedules SET enabled = ? WHERE id = ? AND user_id = ?')
      .run(enabled ? 1 : 0, id, userId).changes > 0
  )
}

export function deleteSchedule(id: number, userId: number): boolean {
  return db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

/** Record the outcome of a fire, and the local date that claimed it. */
export function markScheduleFired(
  id: number,
  localDate: string,
  runId: string | null,
  status: string
): void {
  db.prepare(
    'UPDATE schedules SET last_fired_on = ?, last_run_id = ?, last_status = ? WHERE id = ?'
  ).run(localDate, runId, status, id)
}

// ── Audit trail ───────────────────────────────────────────────────────────────

export function recordLoginEvent(event: {
  userId?: number | null
  email: string
  ip?: string | null
  stage: string
  outcome: 'success' | 'failure'
  detail?: string | null
}): void {
  db.prepare(
    `INSERT INTO login_events (user_id, email, ip, stage, outcome, detail)
     VALUES (@userId, @email, @ip, @stage, @outcome, @detail)`
  ).run({
    userId: event.userId ?? null,
    email: event.email,
    ip: event.ip ?? null,
    stage: event.stage,
    outcome: event.outcome,
    detail: event.detail ?? null,
  })
}

export function recentLoginEvents(userId: number, limit = 10): LoginEventRow[] {
  return db
    .prepare<[number, number], LoginEventRow>(
      'SELECT * FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT ?'
    )
    .all(userId, limit)
}

// ── One-time import of the old users.json ─────────────────────────────────────
// Accounts created before the database existed are copied in on first boot, and
// the file is renamed so it never runs twice.

export function importLegacyUsers(file: string): void {
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
      if (!user?.salt || !user?.hash || findUser(email)) continue
      const row = createUser({
        name: user.name || email.split('@')[0],
        email,
        passwordHash: user.hash,
        passwordSalt: user.salt,
        emailVerified: user.emailVerified ?? true,
      })
      if (user.totpEnabled && user.totpSecret) {
        enableTotpForUser(row.id, user.totpSecret, user.recoveryCodes ?? [])
      }
      imported++
    }
    fs.renameSync(file, `${file}.migrated`)
    console.log(`🗄️  Imported ${imported} account(s) from ${file} — renamed to ${file}.migrated`)
  } catch (err) {
    console.warn(`[db] Could not import ${file}: ${String(err)}`)
  }
}

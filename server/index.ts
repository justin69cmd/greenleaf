import 'dotenv/config'
import express from 'express'
import path from 'path'
import crypto from 'crypto'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import { planTasks } from './agent/planner.js'
import { executeRun } from './agent/run.js'
import { fireSchedule, isDue, runDueSchedules, startScheduler } from './agent/scheduler.js'
import { extractEvents, markClashes, windowFor } from './agent/calendar.js'
import { accessTokenFor, insertEvent, listEvents, type CalendarEvent } from './google.js'
import { getClarifyingQuestions } from './agent/clarify.js'
import { verifyLLMKey } from './agent/llm.js'
import { verifyMail } from './mailer.js'
import QRCode from 'qrcode'
import {
  beginSignup,
  beginLogin,
  beginGoogleSignIn,
  completeGoogleCallback,
  redeemHandoff,
  beginCalendarConnect,
  isGoogleEnabled,
  resendOtp,
  verifyEmailOtp,
  verifyTotpFactor,
  startTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  accountStatus,
  emailForToken,
  revokeToken,
} from './auth.js'
import { originAllowed, safeReturnUrl } from './origins.js'
import { initRunStore, listRuns, getRun, deleteRun } from './agent/store.js'
import * as db from './db.js'
import { recall, recallBlock, searchRuns } from './agent/memory.js'
import type { WSMessage, Task } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Download files the writer agent saved to agent_workspace, so the chat can
// offer them as download chips. Same path confinement as the write_file tool.
app.get('/files/*', (req, res) => {
  const rel = decodeURIComponent((req.params as Record<string, string>)[0] ?? '')
  const base = path.resolve('./agent_workspace')
  const safe = path.resolve(base, rel.replace(/^[/\\]+/, ''))
  if (safe === base || !safe.startsWith(base + path.sep)) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }
  res.download(safe, path.basename(safe), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
  })
})

// ── Auth routes ─────────────────────────────────────────────────────────────
// In-memory rate limit: 25 auth requests per IP per 5 minutes. A single sign-in
// now spends 2-3 of them (credentials, emailed code, authenticator code), so the
// budget is sized for a few honest retries and still a wall for stuffing scripts.
const authHits = new Map<string, number[]>()
function authLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < 5 * 60_000)
  if (hits.length >= 25) {
    res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' })
    return
  }
  hits.push(now)
  authHits.set(ip, hits)
  next()
}

const authFail = (res: express.Response, err: unknown, status = 400) => {
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) })
}

// Every auth call is recorded in the database against the caller's IP.
const ctx = (req: express.Request) => ({ ip: req.ip ?? null })

// Layer 0 — credentials. Neither route issues a session token on its own: both
// return a challenge that has to clear the emailed code (and, when the account
// has an authenticator, a TOTP code) before /auth/verify-* hands out a token.
app.post('/auth/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {}
    res.json(await beginSignup(name, email, password, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    res.json(await beginLogin(email, password, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/auth/resend-otp', authLimiter, async (req, res) => {
  try {
    res.json(await resendOtp((req.body ?? {}).challengeId, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

// Layer 1 — the code emailed to the account address.
app.post('/auth/verify-email-otp', authLimiter, (req, res) => {
  try {
    const { challengeId, code } = req.body ?? {}
    res.json(verifyEmailOtp(challengeId, code, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

// Layer 2 — the authenticator app (or a one-time recovery code).
app.post('/auth/verify-totp', authLimiter, (req, res) => {
  try {
    const { challengeId, code } = req.body ?? {}
    res.json(verifyTotpFactor(challengeId, code, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

// ── Google sign-in ───────────────────────────────────────────────────────────
// The browser goes: /auth/google → Google → /auth/google/callback → back to the
// app with a one-time handoff code, which the app swaps for its session.

app.get('/auth/config', (_req, res) => {
  res.json({ google: isGoogleEnabled() })
})

app.get('/auth/google', authLimiter, (req, res) => {
  try {
    const returnUrl = typeof req.query.redirect === 'string' ? req.query.redirect : undefined
    res.redirect(beginGoogleSignIn(returnUrl))
  } catch (err) {
    authFail(res, err)
  }
})

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>
  // The user pressed "cancel" on Google's consent screen.
  if (error) {
    res.redirect(`${safeReturnUrl(undefined)}?auth_error=${encodeURIComponent(error)}`)
    return
  }
  try {
    const result = await completeGoogleCallback(code ?? '', state ?? '', ctx(req))
    res.redirect(`${result.returnUrl}?handoff=${result.handoff}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.redirect(`${safeReturnUrl(undefined)}?auth_error=${encodeURIComponent(message)}`)
  }
})

app.post('/auth/handoff', authLimiter, (req, res) => {
  try {
    res.json(redeemHandoff((req.body ?? {}).code))
  } catch (err) {
    authFail(res, err)
  }
})

// ── Authenticator enrolment — all require a live session ─────────────────────
function requireUser(req: express.Request, res: express.Response): string | null {
  const email = userFromRequest(req)
  if (!email) {
    res.status(401).json({ error: 'Sign in first.' })
    return null
  }
  return email
}

app.get('/auth/me', (req, res) => {
  const email = requireUser(req, res)
  if (!email) return
  try {
    res.json(accountStatus(email))
  } catch (err) {
    authFail(res, err, 404)
  }
})

app.post('/auth/totp/setup', async (req, res) => {
  const email = requireUser(req, res)
  if (!email) return
  try {
    const setup = startTotpEnrollment(email)
    // Data-URL QR so the modal can render it without a QR library on the client.
    const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 240 })
    res.json({ ...setup, qrDataUrl })
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/auth/totp/enable', authLimiter, (req, res) => {
  const email = requireUser(req, res)
  if (!email) return
  try {
    res.json(confirmTotpEnrollment(email, (req.body ?? {}).code, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/auth/totp/disable', authLimiter, (req, res) => {
  const email = requireUser(req, res)
  if (!email) return
  try {
    res.json(disableTotp(email, (req.body ?? {}).password, ctx(req)))
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/auth/logout', (req, res) => {
  const header = req.headers.authorization
  revokeToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined)
  res.json({ ok: true })
})

// ── Calendar ─────────────────────────────────────────────────────────────────
// Two steps, always: /calendar/extract proposes events from a plan, and
// /calendar/events writes the ones the customer confirmed. Nothing reaches a
// real calendar without that second, explicit call.

app.get('/calendar/connect', authLimiter, (req, res) => {
  // The session token rides in the query because this is a top-level browser
  // navigation, not a fetch — it is exchanged for the account immediately.
  if (!userFromRequest(req)) {
    res.status(401).json({ error: 'Sign in first.' })
    return
  }
  try {
    const returnUrl = typeof req.query.redirect === 'string' ? req.query.redirect : undefined
    res.redirect(beginCalendarConnect(returnUrl))
  } catch (err) {
    authFail(res, err)
  }
})

app.post('/calendar/disconnect', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  db.revokeCalendarGrant(owner.id)
  res.json({ calendarConnected: false })
})

/** Propose events from a run's answer. Read-only: writes nothing anywhere. */
app.post('/calendar/extract', async (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  const body = (req.body ?? {}) as { runId?: string; text?: string; today?: string; timeZone?: string }

  const plan = body.runId ? getRun(body.runId, owner.email)?.summary : body.text
  if (!plan?.trim()) {
    res.status(400).json({ error: 'Nothing to put in the calendar.' })
    return
  }

  try {
    const today = body.today && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10)
    const events = await extractEvents(plan, today)
    const timeZone = String(body.timeZone || 'UTC')

    // Warn about collisions, but only if the calendar is already connected —
    // extraction must work before anyone grants anything.
    let proposed = events.map((e) => e as ReturnType<typeof markClashes>[number])
    const window = windowFor(events, timeZone)
    if (owner.google_refresh_token && window) {
      try {
        const token = await accessTokenFor(owner.google_refresh_token)
        proposed = markClashes(events, await listEvents(token, window.min, window.max), timeZone)
      } catch {
        /* busy-time lookup is advisory — never block the proposal on it */
      }
    }
    res.json({ events: proposed, calendarConnected: Boolean(owner.google_refresh_token) })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** Write the confirmed events. Only ever called after the customer reviews them. */
app.post('/calendar/events', async (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  if (!owner.google_refresh_token) {
    res.status(400).json({ error: 'Connect your Google Calendar first.' })
    return
  }
  const body = (req.body ?? {}) as { events?: CalendarEvent[]; timeZone?: string }
  const events = (body.events ?? []).slice(0, 12)
  if (!events.length) {
    res.status(400).json({ error: 'No events to add.' })
    return
  }

  try {
    const token = await accessTokenFor(owner.google_refresh_token)
    const timeZone = String(body.timeZone || 'UTC')
    const created: { title: string; link: string }[] = []
    const failed: { title: string; error: string }[] = []

    for (const event of events) {
      try {
        const made = await insertEvent(token, event, timeZone)
        created.push({ title: event.title, link: made.htmlLink })
      } catch (err) {
        failed.push({ title: event.title, error: err instanceof Error ? err.message : String(err) })
      }
    }
    db.recordLoginEvent({
      userId: owner.id,
      email: owner.email,
      ip: req.ip ?? null,
      stage: 'calendar_write',
      outcome: failed.length ? 'failure' : 'success',
      detail: `${created.length} added, ${failed.length} failed`,
    })
    res.json({ created, failed })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Schedules ────────────────────────────────────────────────────────────────
// "Every Sunday at 8pm, plan my week and email me the PDF."

const CADENCES = ['daily', 'weekdays', 'weekly'] as const

app.get('/schedules', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  res.json({
    schedules: db.listSchedules(owner.id).map((s) => ({
      id: s.id,
      title: s.title,
      goal: s.goal,
      cadence: s.cadence,
      weekday: s.weekday,
      hour: s.hour,
      minute: s.minute,
      timezone: s.timezone,
      delivery: s.delivery,
      email: s.email,
      enabled: Boolean(s.enabled),
      lastFiredOn: s.last_fired_on,
      lastRunId: s.last_run_id,
      lastStatus: s.last_status,
      nextDue: isDue(s) ? 'now' : null,
    })),
  })
})

app.post('/schedules', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  const b = (req.body ?? {}) as Record<string, unknown>
  const goal = String(b.goal ?? '').trim()
  const cadence = String(b.cadence ?? 'weekly')
  const hour = Number(b.hour)
  const minute = Number(b.minute ?? 0)

  if (!goal) {
    res.status(400).json({ error: 'What should it do? Give it a goal.' })
    return
  }
  if (!CADENCES.includes(cadence as (typeof CADENCES)[number])) {
    res.status(400).json({ error: 'Cadence must be daily, weekdays or weekly.' })
    return
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    res.status(400).json({ error: 'Pick a valid time of day.' })
    return
  }
  // Cap it: each schedule spends the account's model quota unattended.
  if (db.listSchedules(owner.id).length >= 10) {
    res.status(400).json({ error: 'That is as many schedules as one account can have (10).' })
    return
  }

  const schedule = db.createSchedule({
    userId: owner.id,
    title: String(b.title ?? '').trim() || goal.slice(0, 60),
    goal,
    cadence,
    weekday: cadence === 'weekly' ? Number(b.weekday ?? 0) % 7 : null,
    hour,
    minute,
    timezone: String(b.timezone ?? 'UTC'),
    delivery: b.delivery === 'screen' ? 'screen' : 'email',
    email: String(b.email ?? owner.email),
  })
  res.json({ id: schedule.id })
})

app.patch('/schedules/:id', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  const ok = db.setScheduleEnabled(Number(req.params.id), owner.id, (req.body ?? {}).enabled !== false)
  res.status(ok ? 200 : 404).json(ok ? { ok } : { error: 'Schedule not found.' })
})

app.delete('/schedules/:id', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  const ok = db.deleteSchedule(Number(req.params.id), owner.id)
  res.status(ok ? 200 : 404).json(ok ? { ok } : { error: 'Schedule not found.' })
})

/** Run one now, ignoring the clock. */
app.post('/schedules/:id/run', async (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  const schedule = db.findSchedule(Number(req.params.id))
  if (!schedule || schedule.user_id !== owner.id) {
    res.status(404).json({ error: 'Schedule not found.' })
    return
  }
  res.json(await fireSchedule(schedule))
})

/**
 * Cron entry point, for hosts where nothing stays running between requests.
 * Guarded by CRON_SECRET so it can't be used to burn quota from outside.
 */
app.post('/schedules/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET
  const offered = req.headers.authorization?.replace(/^Bearer /, '') ?? String(req.query.key ?? '')
  if (!secret || offered !== secret) {
    res.status(401).json({ error: 'Not authorised.' })
    return
  }
  res.json({ fired: await runDueSchedules() })
})

// ── Sharing a run ────────────────────────────────────────────────────────────
// A share link is a capability: anyone holding it can read that one run. It
// carries no session, grants nothing else, and dies when the owner revokes it.

function ownerRow(req: express.Request, res: express.Response): db.UserRow | null {
  const email = userFromRequest(req)
  const user = email ? db.findUser(email) : undefined
  if (!user) {
    res.status(401).json({ error: 'Sign in first.' })
    return null
  }
  return user
}

/** Publish a run. Idempotent: re-sharing returns the existing link. */
app.post('/runs/:id/share', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  // getRun scopes by owner, so this cannot publish someone else's run.
  const run = getRun(req.params.id, owner.email)
  if (!run) {
    res.status(404).json({ error: 'Run not found.' })
    return
  }
  const existing = db.findShareByRun(run.id)
  const share = db.createShare({
    token: existing?.token ?? crypto.randomBytes(12).toString('base64url'),
    runId: run.id,
    ownerId: owner.id,
    title: run.title,
    allowComments: (req.body ?? {}).allowComments !== false,
  })
  res.json({
    token: share.token,
    url: `${safeReturnUrl(undefined)}?shared=${share.token}`,
    allowComments: Boolean(share.allow_comments),
    views: share.views,
  })
})

app.delete('/runs/:id/share', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  res.json({ revoked: db.deleteShare(req.params.id, owner.id) })
})

/** Every run this account has published, for the history panel. */
app.get('/shares', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  res.json({
    shares: db.listSharesForOwner(owner.id).map((s) => ({
      runId: s.run_id,
      token: s.token,
      title: s.title,
      views: s.views,
      allowComments: Boolean(s.allow_comments),
      createdAt: s.created_at,
    })),
  })
})

/**
 * The public read. No authentication — the link is the credential — so this
 * returns only what the owner meant to publish: the answer and what produced
 * it. Never the owner's email, never the file list, never anything about the
 * account.
 */
app.get('/shared/:token', (req, res) => {
  // The viewer is anonymous, so the run is fetched as the owner recorded on
  // the share row — the link itself is the authorisation.
  const share = db.findShare(req.params.token)
  const owner = share ? db.findUserById(share.owner_id) : undefined
  const run = share && owner ? getRun(share.run_id, owner.email) : null
  if (!share || !run) {
    res.status(404).json({ error: 'This link is no longer available.' })
    return
  }
  db.countShareView(share.token)
  res.json({
    title: run.title,
    goal: run.goal,
    summary: run.summary,
    finishedAt: run.finishedAt,
    status: run.status,
    tasks: run.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      role: t.role,
      status: t.status,
    })),
    allowComments: Boolean(share.allow_comments),
    comments: db.listComments(share.token).map((c) => ({
      id: c.id,
      author: c.author,
      body: c.body,
      at: c.created_at,
      verified: c.user_id !== null,
    })),
  })
})

app.post('/shared/:token/comments', authLimiter, (req, res) => {
  const share = db.findShare(req.params.token)
  if (!share) {
    res.status(404).json({ error: 'This link is no longer available.' })
    return
  }
  if (!share.allow_comments) {
    res.status(403).json({ error: 'Comments are turned off for this run.' })
    return
  }
  const body = String((req.body ?? {}).body ?? '').trim()
  if (!body) {
    res.status(400).json({ error: 'Write something first.' })
    return
  }
  // A signed-in commenter is labelled with their real account name; everyone
  // else picks a display name, which is shown unverified.
  const email = userFromRequest(req)
  const account = email ? db.findUser(email) : undefined
  const author = account?.name ?? String((req.body ?? {}).author ?? '').trim().slice(0, 40)
  if (!author) {
    res.status(400).json({ error: 'Add your name so the owner knows who commented.' })
    return
  }
  const comment = db.addComment({
    token: share.token,
    author,
    userId: account?.id ?? null,
    body: body.slice(0, 2000),
  })
  res.json({
    id: comment.id,
    author: comment.author,
    body: comment.body,
    at: comment.created_at,
    verified: comment.user_id !== null,
  })
})

app.delete('/shared/comments/:id', (req, res) => {
  const owner = ownerRow(req, res)
  if (!owner) return
  res.json({ deleted: db.deleteComment(Number(req.params.id), owner.id) })
})

// ── Run history ─────────────────────────────────────────────────────────────
// History is per-account: a run is only ever listed or returned to the session
// token that owns it. Signed-out sessions have no history at all.
function userFromRequest(req: express.Request): string | null {
  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const query = typeof req.query.token === 'string' ? req.query.token : undefined
  return emailForToken(bearer ?? query)
}

app.get('/runs', (req, res) => {
  const user = userFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Sign in to see your run history.' })
    return
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (q) {
    res.json({
      runs: searchRuns(user, q, 25).map((r) => ({
        id: r.id,
        title: r.title,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        status: r.status,
        taskCount: r.tasks.length,
        totalTokens: r.usage?.totalTokens ?? 0,
        files: r.files,
      })),
    })
    return
  }
  res.json({ runs: listRuns(user, 50) })
})

app.get('/runs/:id', (req, res) => {
  const user = userFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Sign in to see your run history.' })
    return
  }
  const run = getRun(req.params.id, user)
  if (!run) {
    res.status(404).json({ error: 'Run not found' })
    return
  }
  res.json(run)
})

app.delete('/runs/:id', async (req, res) => {
  const user = userFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Sign in to manage your run history.' })
    return
  }
  const ok = await deleteRun(req.params.id, user)
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'Run not found' })
})

type Delivery = 'screen' | 'email'

interface Incoming {
  type?: 'start' | 'clarify' | 'approve' | 'cancel' | 'followup'
  goal?: string
  delivery?: string
  email?: string
  answers?: { question: string; answer: string }[]
  // Chat-style clients auto-approve everything — let them skip the
  // clarifying-questions LLM call entirely instead of discarding it.
  skipClarify?: boolean
  /** Session token — identifies the account that owns the run history. */
  token?: string
}

wss.on('connection', (ws: WebSocket, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, 'Origin not allowed')
    return
  }
  console.log('Client connected')

  const send = (msg: WSMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  // ── Per-connection conversation state ──────────────────────────────────────
  let pending: { goal: string; title: string; delivery: Delivery; email: string } | null = null
  let proposedTasks: Task[] = []
  let lastSummary = '' // carried into follow-ups as context
  let lastDelivery: Delivery = 'screen'
  let lastEmail = ''
  let busy = false // ignore overlapping commands while one is in flight
  // Signed-in account for this socket. Run history and long-term memory are
  // per-account, so a signed-out session gets neither (rather than sharing an
  // "anonymous" history with every other guest).
  let user: string | null = null
  // Passages recalled from this user's past runs, injected into the planner,
  // every specialist, and the synthesizer for the current goal.
  let memoryBlock = ''
  // Aborts the run in flight when the user cancels.
  let runController: AbortController | null = null

  /** Look up related past work and tell the client what was remembered. */
  function loadMemory(goal: string): void {
    memoryBlock = ''
    if (!user) return
    const memories = recall(user, goal)
    if (!memories.length) return
    memoryBlock = recallBlock(memories)
    send({
      type: 'memory',
      payload: memories.map((m) => ({ runId: m.runId, title: m.title, when: m.when })),
    })
  }

  // Run the approved/clarified plan and deliver the result. The pipeline
  // itself lives in agent/run.ts, shared with the scheduler; this wrapper owns
  // the interactive parts — the cancel handle and the follow-up context.
  async function runAndDeliver(goal: string, title: string, delivery: Delivery, email: string, tasks: Task[]) {
    const controller = new AbortController()
    runController = controller
    try {
      const outcome = await executeRun({
        goal,
        title,
        tasks,
        user,
        delivery,
        email,
        memoryBlock,
        send,
        signal: controller.signal,
      })
      if (outcome.status === 'done') lastSummary = outcome.summary
    } finally {
      if (runController === controller) runController = null
    }
  }

  async function proposePlan() {
    if (!pending) return
    send({ type: 'log', payload: 'Drafting a plan…' })
    proposedTasks = await planTasks(pending.goal, memoryBlock)
    send({ type: 'plan_proposed', payload: { tasks: proposedTasks } })
  }

  ws.on('message', async (raw) => {
    let data: Incoming
    try {
      data = JSON.parse(raw.toString()) as Incoming
    } catch {
      send({ type: 'agent_error', payload: 'Invalid message format' })
      return
    }

    // A token may arrive on any message; the chat client sends it with `start`.
    if (data.token) user = emailForToken(data.token)

    // Cancel is handled BEFORE the busy guard — stopping a run in flight is
    // the entire point of it, and a run in flight is exactly when busy is set.
    if (data.type === 'cancel') {
      pending = null
      proposedTasks = []
      if (runController) {
        send({ type: 'log', payload: 'Stopping the team…' })
        runController.abort()
      } else {
        send({ type: 'cancelled', payload: null })
      }
      return
    }

    if (busy) return // a command is already running; ignore extras
    busy = true
    try {
      switch (data.type) {
        case 'start': {
          const goal = (data.goal ?? '').trim()
          if (!goal) {
            send({ type: 'agent_error', payload: 'No goal provided' })
            break
          }
          const delivery: Delivery = data.delivery === 'email' ? 'email' : 'screen'
          const email = (data.email ?? '').trim()
          if (delivery === 'email' && !email) {
            send({ type: 'agent_error', payload: 'No email provided for email delivery' })
            break
          }
          pending = { goal, title: goal, delivery, email }
          lastDelivery = delivery
          lastEmail = email
          loadMemory(goal)

          if (data.skipClarify) {
            await proposePlan()
            break
          }
          send({ type: 'log', payload: 'Reviewing your request…' })
          const questions = await getClarifyingQuestions(goal)
          if (questions.length) {
            send({ type: 'clarify', payload: { questions } })
          } else {
            await proposePlan()
          }
          break
        }

        case 'clarify': {
          if (!pending) break
          const detail = (data.answers ?? [])
            .filter((a) => a && String(a.answer ?? '').trim())
            .map((a) => `- ${a.question} → ${a.answer}`)
            .join('\n')
          if (detail) pending.goal = `${pending.title}\n\nAdditional details from the user:\n${detail}`
          await proposePlan()
          break
        }

        case 'approve': {
          if (!pending) break
          const { goal, title, delivery, email } = pending
          const tasks = proposedTasks.length ? proposedTasks : await planTasks(goal, memoryBlock)
          pending = null
          proposedTasks = []
          await runAndDeliver(goal, title, delivery, email, tasks)
          break
        }

        case 'followup': {
          const fg = (data.goal ?? '').trim()
          if (!fg) break
          const goal = lastSummary
            ? `Earlier you produced this result:\n${lastSummary.slice(0, 800)}\n\nThe user now asks: ${fg}\nUse the earlier result as context.`
            : fg
          send({ type: 'log', payload: 'Working on your follow-up…' })
          loadMemory(fg)
          const tasks = await planTasks(goal, memoryBlock)
          await runAndDeliver(goal, fg, lastDelivery, lastEmail, tasks)
          break
        }

        default:
          send({ type: 'agent_error', payload: 'Unknown request' })
      }
    } catch {
      send({ type: 'agent_error', payload: 'The AI service is busy right now. Please try again in a minute.' })
    } finally {
      busy = false
    }
  })

  ws.on('close', () => {
    // Don't keep spending model quota on a run nobody is listening to.
    runController?.abort()
    console.log('Client disconnected')
  })
})

const PORT = process.env.PORT ?? 4000
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Agent server running on http://localhost:${PORT}`)
  console.log(`   WebSocket ready on ws://localhost:${PORT}\n`)
  void verifyLLMKey()
  void initRunStore()
  // Recurring runs. Needs a process that stays alive; on serverless nothing
  // ticks, and POST /schedules/tick is the way in.
  startScheduler()
  // Sign-in cannot complete without email, so say so at boot rather than
  // letting the first customer discover it.
  void verifyMail().then((mail) => {
    if (mail.ok) console.log(`📧 Email ready via ${mail.provider} — ${mail.detail}`)
    else console.error(`📧 EMAIL BROKEN (${mail.provider}) — nobody can sign in.\n   ${mail.detail}`)
  })
})

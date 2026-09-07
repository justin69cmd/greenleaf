import crypto from 'crypto'
import path from 'path'
import { mailConfigured, otpEmail, sendMail } from './mailer.js'
import * as db from './db.js'
import { authorizeUrl, exchangeCode, googleConfigured, newPkcePair } from './google.js'
import { safeReturnUrl } from './origins.js'
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp.js'

// ── Accounts and two-layer sign-in ────────────────────────────────────────────
// All state lives in the SQLite customer database (server/db.ts): accounts,
// recovery codes, sessions, in-flight challenges, and an audit trail. Nothing
// here is held in memory, so a restart never drops a session or a half-finished
// sign-in.
//
// Sign-in walks two layers and both are mandatory once enrolled:
//   layer 1 — a 6-digit one-time code emailed to the account address
//   layer 2 — a TOTP code from an authenticator app (or a recovery code)
// A password alone never issues a session token.

export interface PublicUser {
  name: string
  email: string
  token: string
  totpEnabled: boolean
}

type Stage = db.Stage
type Purpose = db.Purpose

/** Where the request came from, for the audit trail. */
export interface AuthContext {
  ip?: string | null
}

const OTP_TTL_MS = 5 * 60_000
const OTP_MAX_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_MS = 30_000
const OTP_MAX_RESENDS = 3
const TOTP_MAX_ATTEMPTS = 6
const CHALLENGE_TTL_MS = 10 * 60_000
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
const RECOVERY_CODE_COUNT = 8
const HANDOFF_TTL_MS = 2 * 60_000

// Import accounts written by the pre-database build, once.
db.importLegacyUsers(process.env.USERS_FILE ?? path.join('/tmp', 'users.json'))

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

// Session tokens are only ever stored hashed — a stolen database still can't
// impersonate anyone.
function newToken(userId: number): string {
  const token = crypto.randomBytes(24).toString('hex')
  db.createSession(userId, sha256(token), SESSION_TTL_MS)
  return token
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

function audit(
  stage: string,
  outcome: 'success' | 'failure',
  email: string,
  ctx?: AuthContext,
  detail?: string | null,
  userId?: number | null
): void {
  db.recordLoginEvent({ userId, email, ip: ctx?.ip ?? null, stage, outcome, detail })
}

/** Log the failure, then throw it — every rejection lands in the audit trail. */
function reject(
  message: string,
  stage: string,
  email: string,
  ctx?: AuthContext,
  userId?: number | null
): never {
  audit(stage, 'failure', email, ctx, message, userId)
  throw new Error(message)
}

// ── Layer 1: emailed one-time code ────────────────────────────────────────────

function sixDigitCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

// Echo the code back to the client only when it could not be delivered and we
// are not in production — otherwise a broken mailbox would lock everyone out of
// the demo. Never echoes once NODE_ENV=production.
const devEchoAllowed = () =>
  process.env.NODE_ENV !== 'production' || process.env.AUTH_OTP_DEV_ECHO === 'true'

/** Why the last send failed, so the API can say something useful outside production. */
let lastDeliveryError = ''

async function deliverOtp(to: string, code: string, purpose: Purpose): Promise<boolean> {
  if (!mailConfigured()) {
    lastDeliveryError = 'Email is not configured on this server.'
    console.warn(`[auth] ${lastDeliveryError} OTP for ${to}: ${code}`)
    return false
  }
  const result = await sendMail({ to, ...otpEmail(code, purpose) })
  if (result.ok) {
    lastDeliveryError = ''
    return true
  }
  // Loud, and with the actionable reason — a silent mail failure means nobody
  // can sign in, and the cause is almost always a credential.
  lastDeliveryError = result.detail
  console.error(`[auth] OTP email to ${to} FAILED via ${result.provider}: ${result.detail}`)
  console.error(`[auth] code for ${to} was: ${code}`)
  return false
}

function getChallenge(id: string): db.ChallengeRow {
  db.sweep(CHALLENGE_TTL_MS)
  const challenge = db.findChallenge(id ?? '')
  if (!challenge) throw new Error('This sign-in attempt expired. Please start again.')
  return challenge
}

export interface ChallengeResponse {
  challengeId: string
  stage: Stage
  email: string
  /** Layers this sign-in will walk through, in order. */
  factors: Stage[]
  expiresInSeconds: number
  emailSent: boolean
  /** Present only when delivery failed outside production. */
  devCode?: string
  /** Why delivery failed. Only sent outside production — it names the fix. */
  deliveryError?: string
}

async function issueOtp(challenge: db.ChallengeRow): Promise<ChallengeResponse> {
  const code = sixDigitCode()
  challenge.otp_hash = sha256(code)
  challenge.otp_expires = Date.now() + OTP_TTL_MS
  challenge.otp_attempts = 0
  challenge.otp_sent_at = Date.now()
  db.saveChallenge(challenge)

  const emailSent = await deliverOtp(challenge.email, code, challenge.purpose)
  const totpEnabled = Boolean(db.findUser(challenge.email)?.totp_enabled)

  return {
    challengeId: challenge.id,
    stage: 'email_otp',
    email: challenge.email,
    factors: totpEnabled ? ['email_otp', 'totp'] : ['email_otp'],
    expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
    emailSent,
    ...(!emailSent && devEchoAllowed()
      ? { devCode: code, ...(lastDeliveryError ? { deliveryError: lastDeliveryError } : {}) }
      : {}),
  }
}

function newChallenge(input: {
  email: string
  name: string
  purpose: Purpose
  password?: string
}): db.ChallengeRow {
  const challenge: db.ChallengeRow = {
    id: crypto.randomBytes(18).toString('hex'),
    email: input.email,
    name: input.name,
    purpose: input.purpose,
    stage: 'email_otp',
    password: input.password ?? null,
    otp_hash: '',
    otp_expires: 0,
    otp_attempts: 0,
    otp_sent_at: 0,
    resends: 0,
    totp_attempts: 0,
    created_at: Date.now(),
  }
  db.saveChallenge(challenge)
  return challenge
}

// ── Entry points ──────────────────────────────────────────────────────────────

export async function beginSignup(
  name: string,
  email: string,
  password: string,
  ctx?: AuthContext
): Promise<ChallengeResponse> {
  email = (email ?? '').trim().toLowerCase()
  name = (name ?? '').trim()
  if (!isEmail(email)) reject('Please enter a valid email address.', 'signup', email, ctx)
  if (!password || password.length < 6) {
    reject('Password must be at least 6 characters.', 'signup', email, ctx)
  }

  // An account that never cleared its email check can be claimed again — the
  // code still goes to the real mailbox, so this leaks nothing.
  const existing = db.findUser(email)
  if (existing?.email_verified) {
    reject('An account with this email already exists.', 'signup', email, ctx, existing.id)
  }

  audit('signup', 'success', email, ctx, 'credentials accepted')
  return issueOtp(
    newChallenge({ email, name: name || email.split('@')[0], purpose: 'signup', password })
  )
}

export async function beginLogin(
  email: string,
  password: string,
  ctx?: AuthContext
): Promise<ChallengeResponse> {
  email = (email ?? '').trim().toLowerCase()
  const user = db.findUser(email)
  if (!user) reject('No account found with this email.', 'password', email, ctx)
  if (!user.password_hash || !user.password_salt) {
    reject(
      'This account signs in with Google — use “Continue with Google”.',
      'password',
      email,
      ctx,
      user.id
    )
  }
  if (!safeEqual(hashPassword(password ?? '', user.password_salt), user.password_hash)) {
    reject('Incorrect password.', 'password', email, ctx, user.id)
  }

  audit('password', 'success', email, ctx, null, user.id)
  return issueOtp(newChallenge({ email, name: user.name, purpose: 'login' }))
}

export async function resendOtp(challengeId: string, ctx?: AuthContext): Promise<ChallengeResponse> {
  const challenge = getChallenge(challengeId)
  if (challenge.stage !== 'email_otp') {
    throw new Error('Email verification is already complete for this sign-in.')
  }
  const since = Date.now() - challenge.otp_sent_at
  if (since < OTP_RESEND_COOLDOWN_MS) {
    throw new Error(
      `Please wait ${Math.ceil((OTP_RESEND_COOLDOWN_MS - since) / 1000)}s before requesting another code.`
    )
  }
  if (challenge.resends >= OTP_MAX_RESENDS) {
    db.deleteChallenge(challenge.id)
    reject(
      'Too many codes requested. Please start again.',
      'email_otp',
      challenge.email,
      ctx,
      db.findUser(challenge.email)?.id ?? null
    )
  }
  challenge.resends += 1
  audit('email_otp', 'success', challenge.email, ctx, 'code resent', db.findUser(challenge.email)?.id ?? null)
  return issueOtp(challenge)
}

export interface StageResult {
  /** Next layer to satisfy, or null when the session is issued. */
  stage: Stage | null
  challengeId?: string
  user?: PublicUser
  /** True right after signup, so the UI can offer authenticator enrolment. */
  suggestTotpSetup?: boolean
  /** Set when the user got in with a recovery code. */
  recoveryCodesRemaining?: number
}

function completeChallenge(challenge: db.ChallengeRow, user: db.UserRow): StageResult {
  db.deleteChallenge(challenge.id)
  db.touchLastLogin(user.id)
  return {
    stage: null,
    user: {
      name: user.name,
      email: user.email,
      token: newToken(user.id),
      totpEnabled: Boolean(user.totp_enabled),
    },
    suggestTotpSetup: !user.totp_enabled,
  }
}

/** Layer 1 — verify the emailed code. */
export function verifyEmailOtp(challengeId: string, code: string, ctx?: AuthContext): StageResult {
  const challenge = getChallenge(challengeId)
  // On signup there is no account row yet, so these events start life
  // unattributed and are tied to the customer once it is created.
  const known = db.findUser(challenge.email)?.id ?? null

  if (challenge.stage !== 'email_otp') {
    throw new Error('This code was already used. Enter your authenticator code.')
  }
  if (Date.now() > challenge.otp_expires) {
    reject('That code expired. Request a new one.', 'email_otp', challenge.email, ctx, known)
  }
  if (challenge.otp_attempts >= OTP_MAX_ATTEMPTS) {
    db.deleteChallenge(challenge.id)
    reject('Too many incorrect codes. Please start again.', 'email_otp', challenge.email, ctx, known)
  }
  challenge.otp_attempts += 1
  db.saveChallenge(challenge)

  const candidate = (code ?? '').replace(/\D/g, '')
  if (candidate.length !== 6 || !safeEqual(sha256(candidate), challenge.otp_hash)) {
    const left = OTP_MAX_ATTEMPTS - challenge.otp_attempts
    reject(
      left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code.',
      'email_otp',
      challenge.email,
      ctx,
      known
    )
  }

  // Signup: the account row is only written once the mailbox is proven.
  if (challenge.purpose === 'signup') {
    const salt = crypto.randomBytes(16).toString('hex')
    const user = db.createUser({
      name: challenge.name,
      email: challenge.email,
      passwordHash: hashPassword(challenge.password ?? '', salt),
      passwordSalt: salt,
      emailVerified: true,
    })
    challenge.password = null
    db.saveChallenge(challenge)
    audit('email_otp', 'success', user.email, ctx, 'email verified', user.id)
    audit('signup', 'success', user.email, ctx, 'account created', user.id)
    return completeChallenge(challenge, user)
  }

  const user = db.findUser(challenge.email)
  if (!user) throw new Error('No account found with this email.')
  if (!user.email_verified) db.markEmailVerified(user.id)
  audit('email_otp', 'success', user.email, ctx, null, user.id)

  // Layer 2 only applies to accounts that enrolled an authenticator.
  if (user.totp_enabled) {
    challenge.stage = 'totp'
    db.saveChallenge(challenge)
    return { stage: 'totp', challengeId: challenge.id }
  }
  return completeChallenge(challenge, user)
}

/** Layer 2 — verify a TOTP code from the authenticator app, or a recovery code. */
export function verifyTotpFactor(
  challengeId: string,
  code: string,
  ctx?: AuthContext
): StageResult {
  const challenge = getChallenge(challengeId)
  if (challenge.stage !== 'totp') throw new Error('Verify the emailed code first.')
  if (challenge.totp_attempts >= TOTP_MAX_ATTEMPTS) {
    db.deleteChallenge(challenge.id)
    reject('Too many incorrect codes. Please start again.', 'totp', challenge.email, ctx)
  }
  challenge.totp_attempts += 1
  db.saveChallenge(challenge)

  const user = db.findUser(challenge.email)
  if (!user?.totp_secret) throw new Error('No authenticator is set up for this account.')

  if (verifyTotp(user.totp_secret, code)) {
    audit('totp', 'success', user.email, ctx, null, user.id)
    return completeChallenge(challenge, user)
  }

  // Recovery codes are single use — the row is deleted as it is spent.
  const normalized = normalizeRecoveryCode(code)
  if (normalized.length === 10 && db.consumeRecoveryCode(user.id, hashRecoveryCode(normalized))) {
    const remaining = db.countRecoveryCodes(user.id)
    audit('recovery_code', 'success', user.email, ctx, `${remaining} left`, user.id)
    return { ...completeChallenge(challenge, user), recoveryCodesRemaining: remaining }
  }

  const left = TOTP_MAX_ATTEMPTS - challenge.totp_attempts
  reject(
    left > 0
      ? `That code didn't match. ${left} attempt${left === 1 ? '' : 's'} left.`
      : "That code didn't match.",
    'totp',
    user.email,
    ctx,
    user.id
  )
}

// ── Google sign-in ────────────────────────────────────────────────────────────
// Google proves the person controls the mailbox, which is exactly what layer 1
// proves — so a Google sign-in replaces the emailed code. It does NOT replace
// layer 2: an account with an authenticator still has to produce a code, or
// enabling Google would quietly become a way around it.

export const isGoogleEnabled = googleConfigured

/** Step 1 — build the URL to send the browser to Google. */
export function beginGoogleSignIn(returnUrl?: string): string {
  if (!googleConfigured()) {
    throw new Error('Google sign-in is not configured on this server.')
  }
  const state = crypto.randomBytes(18).toString('hex')
  const { verifier, challenge } = newPkcePair()
  db.saveOAuthState(state, verifier, safeReturnUrl(returnUrl))
  return authorizeUrl(state, challenge)
}

export interface GoogleCallbackResult {
  /** Where to send the browser, with the handoff code attached. */
  returnUrl: string
  handoff: string
}

/**
 * Step 2 — Google came back with a code. Exchange it, find or create the
 * account, and park the result under a one-time handoff code so the session
 * token never travels in a URL.
 */
export async function completeGoogleCallback(
  code: string,
  state: string,
  ctx?: AuthContext
): Promise<GoogleCallbackResult> {
  const saved = db.takeOAuthState(state ?? '')
  if (!saved) throw new Error('That Google sign-in expired or was already used. Please try again.')

  const identity = await exchangeCode(code, saved.code_verifier)
  if (!identity.emailVerified) {
    reject('Google has not verified that email address.', 'google', identity.email, ctx)
  }

  let user = db.findUserByGoogleSub(identity.sub)
  if (!user) {
    const byEmail = db.findUser(identity.email)
    if (byEmail) {
      // Same verified address: link Google to the existing account rather than
      // creating a second one the customer would have to keep track of.
      db.linkGoogleAccount(byEmail.id, identity.sub, identity.picture)
      user = db.findUser(identity.email)!
      audit('google', 'success', user.email, ctx, 'linked to existing account', user.id)
    } else {
      user = db.createUser({
        name: identity.name,
        email: identity.email,
        emailVerified: true,
        googleSub: identity.sub,
        avatarUrl: identity.picture,
      })
      audit('google', 'success', user.email, ctx, 'account created', user.id)
    }
  } else {
    audit('google', 'success', user.email, ctx, null, user.id)
  }

  // Google satisfied layer 1. If the account has an authenticator, hand back a
  // challenge parked at layer 2 instead of a session.
  let payload: StageResult
  if (user.totp_enabled) {
    const challenge = newChallenge({ email: user.email, name: user.name, purpose: 'login' })
    challenge.stage = 'totp'
    db.saveChallenge(challenge)
    payload = { stage: 'totp', challengeId: challenge.id }
  } else {
    db.touchLastLogin(user.id)
    payload = {
      stage: null,
      user: {
        name: user.name,
        email: user.email,
        token: newToken(user.id),
        totpEnabled: false,
      },
      suggestTotpSetup: true,
    }
  }

  const handoff = crypto.randomBytes(24).toString('hex')
  db.saveHandoff(handoff, payload)
  return { returnUrl: saved.return_url, handoff }
}

/** Step 3 — the app swaps its handoff code for the session (or the next layer). */
export function redeemHandoff(code: string): StageResult {
  db.sweep(CHALLENGE_TTL_MS)
  const row = db.takeHandoff(code ?? '')
  if (!row) throw new Error('That sign-in link was already used. Please sign in again.')
  if (Date.now() - row.created_at > HANDOFF_TTL_MS) {
    throw new Error('That sign-in took too long. Please try again.')
  }
  return JSON.parse(row.payload) as StageResult
}

// ── Authenticator enrolment (requires a live session) ─────────────────────────

export interface TotpSetup {
  secret: string
  otpauthUrl: string
  email: string
}

export function startTotpEnrollment(email: string): TotpSetup {
  const user = db.findUser(email)
  if (!user) throw new Error('Account not found.')
  if (user.totp_enabled) throw new Error('An authenticator is already set up for this account.')

  const secret = generateTotpSecret()
  db.setPendingTotpSecret(user.id, secret)
  return { secret, otpauthUrl: otpauthUrl(user.email, secret), email: user.email }
}

export function confirmTotpEnrollment(
  email: string,
  code: string,
  ctx?: AuthContext
): { recoveryCodes: string[] } {
  const user = db.findUser(email)
  if (!user) throw new Error('Account not found.')
  if (!user.pending_totp_secret) throw new Error('Start the authenticator setup first.')
  if (!verifyTotp(user.pending_totp_secret, code)) {
    reject(
      "That code didn't match. Check your authenticator and try again.",
      'totp_enrol',
      email,
      ctx,
      user.id
    )
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
  db.enableTotpForUser(user.id, user.pending_totp_secret, recoveryCodes.map(hashRecoveryCode))
  audit('totp_enrol', 'success', email, ctx, 'authenticator enabled', user.id)
  return { recoveryCodes }
}

/**
 * Turn the authenticator off. Proof required: the account password, or — for a
 * Google-only account, which has none — a current code from the authenticator
 * being removed.
 */
export function disableTotp(
  email: string,
  proof: string,
  ctx?: AuthContext
): { totpEnabled: false } {
  const user = db.findUser(email)
  if (!user) throw new Error('Account not found.')
  if (user.password_hash && user.password_salt) {
    if (!safeEqual(hashPassword(proof ?? '', user.password_salt), user.password_hash)) {
      reject('Incorrect password.', 'totp_disable', email, ctx, user.id)
    }
  } else if (!user.totp_secret || !verifyTotp(user.totp_secret, proof ?? '')) {
    reject(
      "That code didn't match. Enter a current code from your authenticator.",
      'totp_disable',
      email,
      ctx,
      user.id
    )
  }
  db.disableTotpForUser(user.id)
  audit('totp_disable', 'success', email, ctx, 'authenticator disabled', user.id)
  return { totpEnabled: false }
}

export interface AccountStatus {
  name: string
  email: string
  totpEnabled: boolean
  recoveryCodesRemaining: number
  createdAt: string
  lastLoginAt: string | null
  /** Signed in with Google at least once. */
  googleLinked: boolean
  /** False for Google-only accounts — they turn the authenticator off with a code. */
  hasPassword: boolean
  avatarUrl: string | null
  recentActivity: { stage: string; outcome: string; ip: string | null; at: string }[]
}

export function accountStatus(email: string): AccountStatus {
  const user = db.findUser(email)
  if (!user) throw new Error('Account not found.')
  return {
    name: user.name,
    email: user.email,
    totpEnabled: Boolean(user.totp_enabled),
    recoveryCodesRemaining: db.countRecoveryCodes(user.id),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    googleLinked: Boolean(user.google_sub),
    hasPassword: Boolean(user.password_hash),
    avatarUrl: user.avatar_url,
    recentActivity: db.recentLoginEvents(user.id, 5).map((e) => ({
      stage: e.stage,
      outcome: e.outcome,
      ip: e.ip,
      at: e.created_at,
    })),
  }
}

// Resolve a session token back to its email (used to authorize the agent run).
export function emailForToken(token?: string): string | null {
  if (!token) return null
  return db.emailForSession(sha256(token))
}

export function revokeToken(token?: string): void {
  if (token) db.deleteSession(sha256(token))
}

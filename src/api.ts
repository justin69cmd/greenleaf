// Deployed backend by default. Set VITE_API_URL / VITE_WS_URL in a local
// .env to point the app at a server running on your own machine.
export const API_URL = import.meta.env.VITE_API_URL || 'https://greenleaf-backend.vercel.app'
export const WS_URL = import.meta.env.VITE_WS_URL || 'wss://greenleaf-backend.vercel.app'

export interface User {
  name: string
  email: string
  token: string
  totpEnabled?: boolean
}

// ── Two-layer sign-in ─────────────────────────────────────────────────────────
// Credentials alone never return a token. /auth/login and /auth/signup open a
// challenge; the token is issued once the emailed code (layer 1) and, for
// accounts with an authenticator, the TOTP code (layer 2) both check out.

export type AuthStage = 'email_otp' | 'totp'

export interface AuthChallenge {
  challengeId: string
  stage: AuthStage
  email: string
  factors: AuthStage[]
  expiresInSeconds: number
  emailSent: boolean
  /** Dev convenience: present only when the server could not send the email. */
  devCode?: string
  /** Why delivery failed — sent outside production only. */
  deliveryError?: string
}

export interface StageResult {
  stage: AuthStage | null
  challengeId?: string
  user?: User
  suggestTotpSetup?: boolean
  recoveryCodesRemaining?: number
}

async function authPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Something went wrong. Please try again.')
  }
  return data as T
}

/** Step 0 — check credentials and send the first one-time code. */
export function beginAuth(
  mode: 'login' | 'signup',
  body: Record<string, string>
): Promise<AuthChallenge> {
  return authPost<AuthChallenge>(`/auth/${mode}`, body)
}

/** Step 1 — the 6-digit code emailed to the account address. */
export function verifyEmailOtp(challengeId: string, code: string): Promise<StageResult> {
  return authPost<StageResult>('/auth/verify-email-otp', { challengeId, code })
}

/** Step 2 — an authenticator code, or one of the recovery codes. */
export function verifyTotp(challengeId: string, code: string): Promise<StageResult> {
  return authPost<StageResult>('/auth/verify-totp', { challengeId, code })
}

export function resendEmailOtp(challengeId: string): Promise<AuthChallenge> {
  return authPost<AuthChallenge>('/auth/resend-otp', { challengeId })
}

// ── Google sign-in ────────────────────────────────────────────────────────────
// Google proves the email address, so it stands in for layer 1. An account with
// an authenticator still has to clear layer 2 afterwards.

/** Is "Continue with Google" configured on the server? */
export async function fetchAuthConfig(): Promise<{ google: boolean }> {
  try {
    const res = await fetch(`${API_URL}/auth/config`)
    if (!res.ok) return { google: false }
    return (await res.json()) as { google: boolean }
  } catch {
    return { google: false }
  }
}

/** Leave for Google, asking it to send the browser back to this page. */
export function googleSignInUrl(returnTo: string = window.location.origin + window.location.pathname): string {
  return `${API_URL}/auth/google?redirect=${encodeURIComponent(returnTo)}`
}

/** Swap the one-time code Google's callback appended for a session, or layer 2. */
export function redeemHandoff(code: string): Promise<StageResult> {
  return authPost<StageResult>('/auth/handoff', { code })
}

// ── Authenticator enrolment (needs a live session token) ──────────────────────

export interface TotpSetup {
  secret: string
  otpauthUrl: string
  qrDataUrl: string
  email: string
}

export function startTotpSetup(token: string): Promise<TotpSetup> {
  return authPost<TotpSetup>('/auth/totp/setup', {}, token)
}

export function enableTotp(token: string, code: string): Promise<{ recoveryCodes: string[] }> {
  return authPost<{ recoveryCodes: string[] }>('/auth/totp/enable', { code }, token)
}

/** `proof` is the account password, or an authenticator code for Google-only accounts. */
export function disableTotp(token: string, proof: string): Promise<{ totpEnabled: false }> {
  return authPost<{ totpEnabled: false }>('/auth/totp/disable', { password: proof }, token)
}

export interface AccountStatus {
  name: string
  email: string
  totpEnabled: boolean
  recoveryCodesRemaining: number
  /** Straight from the customer database, so the UI can show account history. */
  createdAt: string
  lastLoginAt: string | null
  googleLinked: boolean
  /** False for Google-only accounts: they confirm with an authenticator code. */
  hasPassword: boolean
  avatarUrl: string | null
  recentActivity: { stage: string; outcome: string; ip: string | null; at: string }[]
}

export async function fetchAccount(token: string): Promise<AccountStatus> {
  const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not load your account.')
  return data as AccountStatus
}

export function logout(token: string): Promise<{ ok: true }> {
  return authPost<{ ok: true }>('/auth/logout', {}, token)
}

const STORE_KEY = 'equilibrium_user'

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function saveUser(user: User | null): void {
  if (user) localStorage.setItem(STORE_KEY, JSON.stringify(user))
  else localStorage.removeItem(STORE_KEY)
}

// ── Run history ───────────────────────────────────────────────────────────────
// The backend persists every completed run against the signed-in account, so
// the app can list past work, reopen an answer, and re-download its artifacts.

export interface RunSummary {
  id: string
  title: string
  startedAt: number
  finishedAt: number
  status: 'done' | 'error' | 'cancelled'
  taskCount: number
  totalTokens: number
  files: string[]
}

export interface RunTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  role?: string
  result?: string
  dependsOn?: string[]
  durationMs?: number
}

export interface RunUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
  byModel: Record<string, number>
  elapsedMs: number
}

export interface RunDetail extends RunSummary {
  goal: string
  summary: string
  tasks: RunTask[]
  usage: RunUsage
}

async function runsFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not reach your run history.')
  return data as T
}

/** List the signed-in user's runs, newest first. Pass `query` to search them. */
export async function fetchRuns(token: string, query = ''): Promise<RunSummary[]> {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  const data = await runsFetch<{ runs: RunSummary[] }>(`/runs${suffix}`, token)
  return data.runs ?? []
}

export async function fetchRun(token: string, id: string): Promise<RunDetail> {
  return runsFetch<RunDetail>(`/runs/${encodeURIComponent(id)}`, token)
}

export async function removeRun(token: string, id: string): Promise<void> {
  await runsFetch(`/runs/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
}

/** Download URL for a file an agent saved in the shared workspace. */
export function fileUrl(relPath: string): string {
  return `${API_URL}/files/${relPath.split('/').map(encodeURIComponent).join('/')}`
}

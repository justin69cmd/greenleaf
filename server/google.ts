import crypto from 'crypto'

// ── "Continue with Google" ────────────────────────────────────────────────────
// OAuth 2.0 authorization-code flow with PKCE. The browser never sees the
// client secret and never handles a token: it bounces to Google, comes back to
// /auth/google/callback with a code, and this module trades that code for the
// user's identity server-side.
//
// Set up at https://console.cloud.google.com/apis/credentials — create an
// "OAuth client ID" of type "Web application", add the callback below to
// "Authorised redirect URIs", and put the id/secret in the server .env.

// Endpoints are overridable so the flow can be exercised against a mock.
const AUTH_ENDPOINT = process.env.GOOGLE_AUTH_ENDPOINT ?? 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = process.env.GOOGLE_TOKEN_ENDPOINT ?? 'https://oauth2.googleapis.com/token'

export const googleConfigured = (): boolean =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

/** Where Google sends the browser back. Must match the console entry exactly. */
export function callbackUrl(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.SERVER_ORIGIN ?? `http://localhost:${process.env.PORT ?? 4000}`}/auth/google/callback`
  )
}

const base64url = (buf: Buffer) => buf.toString('base64url')

export interface PkcePair {
  verifier: string
  challenge: string
}

export function newPkcePair(): PkcePair {
  const verifier = base64url(crypto.randomBytes(32))
  return {
    verifier,
    challenge: base64url(crypto.createHash('sha256').update(verifier).digest()),
  }
}

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export function authorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Always show the chooser: people share machines, and a silent re-login
    // into the wrong account is a confusing way to lose your data.
    prompt: 'select_account',
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Incremental auth: calendar access is asked for separately, when the customer
 * actually wants their plan written to their calendar — never bundled into
 * sign-in. `access_type=offline` plus `prompt=consent` is what makes Google
 * return a refresh token, which is the only way to write later without them
 * sitting there.
 */
export function calendarAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: `openid email ${CALENDAR_SCOPE}`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture?: string
  /** Only present on a consent that asked for offline access (calendar). */
  refreshToken?: string
  accessToken?: string
}

/** The claims Google puts in an id_token; only the ones we actually use. */
interface IdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  given_name?: string
  picture?: string
  aud?: string
  iss?: string
  exp?: number
}

function decodeIdToken(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('Google returned a malformed id_token.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims
}

/**
 * Swap the one-time code for the signed-in identity.
 *
 * The id_token comes straight from Google's token endpoint over TLS, in
 * response to a request carrying our client secret, so its signature does not
 * need re-checking here (OpenID Connect 3.1.3.7). The issuer, audience and
 * expiry are still checked, because those are about *which* token this is.
 */
export async function exchangeCode(code: string, verifier: string): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as {
    id_token?: string
    refresh_token?: string
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !data.id_token) {
    throw new Error(
      `Google rejected the sign-in (${data.error_description ?? data.error ?? res.status}).`
    )
  }

  const claims = decodeIdToken(data.id_token)
  const issuers = ['https://accounts.google.com', 'accounts.google.com']
  if (claims.iss && !issuers.includes(claims.iss)) {
    throw new Error('That token did not come from Google.')
  }
  if (claims.aud && claims.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error('That token was issued for a different app.')
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new Error('Google returned an expired token — please try again.')
  }
  if (!claims.sub || !claims.email) {
    throw new Error('Google did not share an email address for this account.')
  }

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    // Google sends this as a real boolean, but has historically used strings.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name || claims.given_name || claims.email.split('@')[0],
    picture: claims.picture,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    ...(data.access_token ? { accessToken: data.access_token } : {}),
  }
}

// ── Calendar API ──────────────────────────────────────────────────────────────
// Access tokens last an hour; the refresh token is what we keep. Every call
// mints a fresh access token rather than caching one across a serverless
// instance that may not exist a minute later.

const CALENDAR_API = process.env.GOOGLE_CALENDAR_API ?? 'https://www.googleapis.com/calendar/v3'

export async function accessTokenFor(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
    error?: string
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google would not renew calendar access (${data.error_description ?? data.error ?? res.status}). Reconnect your calendar.`
    )
  }
  return data.access_token
}

export interface CalendarEvent {
  title: string
  /** RFC 3339, e.g. 2026-09-14T09:00:00 (local to `timeZone`). */
  start: string
  end: string
  notes?: string
}

export interface BusySlot {
  title: string
  start: string
  end: string
}

/** What is already on the calendar in a window — used to warn about clashes. */
export async function listEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<BusySlot[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const data = (await res.json()) as {
    items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[]
  }
  return (data.items ?? []).map((e) => ({
    title: e.summary ?? '(busy)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
  }))
}

export async function insertEvent(
  accessToken: string,
  event: CalendarEvent,
  timeZone: string
): Promise<{ id: string; htmlLink: string }> {
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: event.title,
      description: event.notes ? `${event.notes}\n\n— planned with GreenLeaf` : 'Planned with GreenLeaf',
      start: { dateTime: event.start, timeZone },
      end: { dateTime: event.end, timeZone },
      source: { title: 'GreenLeaf', url: process.env.APP_ORIGIN ?? 'https://greenleaf.app' },
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    id?: string
    htmlLink?: string
    error?: { message?: string }
  }
  if (!res.ok || !data.id) {
    throw new Error(`Google rejected "${event.title}": ${data.error?.message ?? res.status}`)
  }
  return { id: data.id, htmlLink: data.htmlLink ?? '' }
}

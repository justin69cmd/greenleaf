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

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture?: string
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
  }
}

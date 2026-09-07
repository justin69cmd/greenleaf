// Which browser origins this server will talk to: used for websocket Origin
// checks and to make sure an OAuth sign-in can only ever hand a session back
// to one of our own pages (never an attacker-supplied redirect).

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const APP_ORIGIN = (process.env.APP_ORIGIN ?? '').trim()

const isLocalhost = (origin: string) =>
  process.env.NODE_ENV !== 'production' &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

// Browsers send an Origin header — reject cross-site pages so a random website
// can't drive the agent. Non-browser clients (no Origin) pass, which keeps
// local tooling working. localhost is allowed outside production so the app
// can be developed against a server on the same machine.
export function originAllowed(origin?: string): boolean {
  if (!origin) return true
  if (/^https:\/\/greenleaf-backend\.vercel\.app$/.test(origin)) return true
  if (APP_ORIGIN && origin === APP_ORIGIN) return true
  if (EXTRA_ORIGINS.includes(origin)) return true
  return isLocalhost(origin)
}

/**
 * Where an OAuth sign-in may send the browser afterwards. Anything not on the
 * allowlist falls back to APP_ORIGIN — an open redirect here would let a
 * phishing page collect real sessions.
 */
export function safeReturnUrl(candidate: string | undefined, fallback = APP_ORIGIN): string {
  if (candidate) {
    try {
      const url = new URL(candidate)
      if (originAllowed(url.origin)) return `${url.origin}${url.pathname}`
    } catch {
      /* not a URL — fall through */
    }
  }
  return fallback || 'http://localhost:5173'
}

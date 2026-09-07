import crypto from 'crypto'

// ── TOTP (RFC 6238) + base32 (RFC 4648), implemented on node:crypto ───────────
// Small enough to keep in-tree, and it means the second factor works with any
// authenticator app (Google Authenticator, Authy, 1Password, …) without pulling
// in a dependency.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
// Accept the neighbouring steps too, so a phone clock that drifts a few
// seconds — or a user who types slowly — still gets in.
const WINDOW = 1

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// A 20-byte secret is what RFC 4226 recommends for HMAC-SHA1.
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const digest = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function totpCode(secretBase32: string, at: number = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(at / 1000 / STEP_SECONDS))
}

export function verifyTotp(secretBase32: string, code: string, at: number = Date.now()): boolean {
  const candidate = (code ?? '').replace(/\D/g, '')
  if (candidate.length !== DIGITS) return false
  const secret = base32Decode(secretBase32)
  const counter = Math.floor(at / 1000 / STEP_SECONDS)
  for (let drift = -WINDOW; drift <= WINDOW; drift++) {
    const expected = hotp(secret, counter + drift)
    if (
      expected.length === candidate.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
    ) {
      return true
    }
  }
  return false
}

// Seconds left on the current 30s step — handy for the UI countdown.
export function totpSecondsRemaining(at: number = Date.now()): number {
  return STEP_SECONDS - (Math.floor(at / 1000) % STEP_SECONDS)
}

export function otpauthUrl(email: string, secretBase32: string, issuer = 'GreenLeaf'): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ── Recovery codes ────────────────────────────────────────────────────────────
// Shown once at enrolment, stored only as hashes, and burned on use.
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase() // 10 chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return codes
}

export function normalizeRecoveryCode(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

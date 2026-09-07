import nodemailer, { type Transporter } from 'nodemailer'

// ── Outbound email ────────────────────────────────────────────────────────────
// One place that knows how to send mail, because sign-in depends on it: layer 1
// of the two-factor flow is a code emailed to the customer.
//
// Two providers, picked from the environment:
//   RESEND_API_KEY  → Resend's HTTPS API. Preferred on serverless hosts, where
//                     outbound SMTP is often blocked or rate-limited.
//   SMTP_USER/PASS  → plain SMTP (Gmail, Fastmail, your own server).
//
// Gmail note: SMTP_PASS must be a 16-character App Password, not the account
// password — Google stopped accepting account passwords over SMTP in 2022.

export type Provider = 'resend' | 'smtp' | 'none'

export interface MailResult {
  ok: boolean
  provider: Provider
  /** Human-readable outcome, safe to log. Never contains the credential. */
  detail: string
}

export interface Attachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: Attachment[]
}

export function provider(): Provider {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp'
  return 'none'
}

export const mailConfigured = (): boolean => provider() !== 'none'

/** The address mail is sent from. Resend needs a verified domain here. */
export function fromAddress(): string {
  return process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'onboarding@resend.dev'
}

// Reused across invocations so a warm instance doesn't reconnect every time.
let transporter: Transporter | null = null
function smtpTransport(): Transporter {
  if (transporter) return transporter
  const port = Number(process.env.SMTP_PORT ?? 587)
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  })
  return transporter
}

/**
 * Turn a mail failure into something a human can act on. The raw SMTP codes are
 * unhelpful, and the most common one by far means "you used the wrong kind of
 * password".
 */
export function explain(err: unknown): string {
  const error = err as { code?: string; responseCode?: number; response?: string; message?: string }
  const response = String(error?.response ?? error?.message ?? err)

  if (response.includes('535') || error?.code === 'EAUTH') {
    const usingGmail = (process.env.SMTP_HOST ?? 'smtp.gmail.com').includes('gmail')
    return usingGmail
      ? 'Gmail rejected the credentials (535). SMTP_PASS must be a 16-character App Password from https://myaccount.google.com/apppasswords — the normal account password does not work, and 2-Step Verification has to be on first.'
      : `The mail server rejected the credentials (535): ${response.slice(0, 160)}`
  }
  if (response.includes('534')) {
    return 'Google wants an application-specific password (534). Create one at https://myaccount.google.com/apppasswords.'
  }
  if (error?.code === 'ENOTFOUND' || error?.code === 'EDNS') {
    return `Could not resolve the mail host (${process.env.SMTP_HOST ?? 'smtp.gmail.com'}). Check SMTP_HOST.`
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKET' || error?.code === 'ECONNECTION') {
    return 'Could not reach the mail server. Some hosts block outbound SMTP — set RESEND_API_KEY to send over HTTPS instead.'
  }
  return response.slice(0, 200)
}

async function sendViaResend(mail: Mail): Promise<MailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.attachments?.length
        ? {
            attachments: mail.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString('base64'),
            })),
          }
        : {}),
    }),
  })
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
  if (!res.ok) {
    return {
      ok: false,
      provider: 'resend',
      detail: `Resend rejected the message (${res.status}): ${data.message ?? data.name ?? 'unknown error'}`,
    }
  }
  return { ok: true, provider: 'resend', detail: `Sent to ${mail.to} (Resend id ${data.id ?? '—'})` }
}

/** Send one message. Never throws — the caller decides what a failure means. */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const which = provider()
  if (which === 'none') {
    return {
      ok: false,
      provider: 'none',
      detail: 'Email is not configured (set RESEND_API_KEY, or SMTP_USER and SMTP_PASS).',
    }
  }
  try {
    if (which === 'resend') return await sendViaResend(mail)
    await smtpTransport().sendMail({
      from: fromAddress(),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
    })
    return { ok: true, provider: 'smtp', detail: `Sent to ${mail.to}` }
  } catch (err) {
    return { ok: false, provider: which, detail: explain(err) }
  }
}

/** Check the credentials without sending anything. Used at boot and by mail:test. */
export async function verifyMail(): Promise<MailResult> {
  const which = provider()
  if (which === 'none') {
    return {
      ok: false,
      provider: 'none',
      detail: 'Email is not configured (set RESEND_API_KEY, or SMTP_USER and SMTP_PASS).',
    }
  }
  if (which === 'resend') {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      return res.ok
        ? { ok: true, provider: 'resend', detail: `Resend key accepted, sending as ${fromAddress()}` }
        : { ok: false, provider: 'resend', detail: `Resend rejected the API key (${res.status}).` }
    } catch (err) {
      return { ok: false, provider: 'resend', detail: explain(err) }
    }
  }
  try {
    await smtpTransport().verify()
    return { ok: true, provider: 'smtp', detail: `SMTP ready, sending as ${fromAddress()}` }
  } catch (err) {
    return { ok: false, provider: 'smtp', detail: explain(err) }
  }
}

// ── The one-time-code email ───────────────────────────────────────────────────

export function otpEmail(code: string, purpose: 'login' | 'signup'): Omit<Mail, 'to'> {
  const intro =
    purpose === 'signup'
      ? 'Welcome to GreenLeaf. Use this code to verify your email address:'
      : 'Someone is signing in to your GreenLeaf account. Use this code to continue:'
  return {
    subject: `${code} is your GreenLeaf verification code`,
    text: `${intro}\n\n    ${code}\n\nIt expires in 5 minutes. If this wasn't you, ignore this email and change your password.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#111">
  <p style="font-size:20px;font-weight:600;margin:0 0 4px">🌿 GreenLeaf</p>
  <p style="color:#555;margin:0 0 24px">${intro}</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f2f7f4;border:1px solid #d8e8de;border-radius:12px;padding:16px;text-align:center;margin:0">${code}</p>
  <p style="color:#777;font-size:13px;margin:24px 0 0">It expires in 5 minutes. If this wasn't you, ignore this email and change your password.</p>
</div>`,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  beginAuth,
  enableTotp,
  fetchAuthConfig,
  googleSignInUrl,
  redeemHandoff,
  resendEmailOtp,
  startTotpSetup,
  verifyEmailOtp,
  verifyTotp,
  type AuthChallenge,
  type TotpSetup,
  type User,
} from '@/api'

// Drives the two-layer sign-in state machine so every login surface behaves
// identically:
//
//   credentials → email_otp → [totp] → [enroll] → done
//
// The middle steps are server-driven: the response to each step says which
// layer comes next, and a session token only appears on the last one.

export type AuthStep = 'credentials' | 'email_otp' | 'totp' | 'enroll' | 'done'
export type AuthMode = 'login' | 'signup'

const RESEND_COOLDOWN = 30

export function useAuthFlow(
  onComplete?: (user: User) => void,
  initialMode: AuthMode = 'login',
  /** One-time code from Google's callback, if the app came back with one. */
  handoff?: string
) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [step, setStep] = useState<AuthStep>('credentials')
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  // Countdowns: how long the emailed code stays valid, and when a resend is allowed.
  const [expiresIn, setExpiresIn] = useState(0)
  const [resendIn, setResendIn] = useState(0)

  // Enrolment (optional second layer, offered once a session exists).
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  // "Continue with Google" only appears when the server has credentials for it.
  const [googleAvailable, setGoogleAvailable] = useState(false)
  useEffect(() => {
    let live = true
    fetchAuthConfig().then((cfg) => live && setGoogleAvailable(cfg.google))
    return () => {
      live = false
    }
  }, [])

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    timer.current = setInterval(() => {
      setExpiresIn((s) => (s > 0 ? s - 1 : 0))
      setResendIn((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  const message = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.toLowerCase().includes('failed to fetch')
      ? 'Could not reach the server — is it running?'
      : msg
  }

  const applyChallenge = useCallback((c: AuthChallenge) => {
    setChallenge(c)
    setExpiresIn(c.expiresInSeconds)
    setResendIn(RESEND_COOLDOWN)
    setStep('email_otp')
    setNotice(
      c.emailSent
        ? `We sent a 6-digit code to ${c.email}.`
        : c.devCode
          ? `Email delivery is not configured on this server, so here is the code: ${c.devCode}`
          : 'We could not send the email — check the server logs for the code.'
    )
  }, [])

  /** Step 0 — email + password (+ name on signup). */
  const submitCredentials = useCallback(
    async (fields: { email: string; password: string; name?: string }) => {
      setError('')
      setLoading(true)
      try {
        const body: Record<string, string> = {
          email: fields.email.trim(),
          password: fields.password,
        }
        if (mode === 'signup') body.name = fields.name ?? ''
        applyChallenge(await beginAuth(mode, body))
      } catch (err) {
        setError(message(err))
      } finally {
        setLoading(false)
      }
    },
    [mode, applyChallenge]
  )

  const finish = useCallback(
    (u: User, suggestSetup: boolean) => {
      setUser(u)
      setChallenge(null)
      if (suggestSetup) {
        setStep('enroll')
        setNotice('')
      } else {
        setStep('done')
        onComplete?.(u)
      }
    },
    [onComplete]
  )

  /** Layer 1 — the emailed code. */
  const submitEmailCode = useCallback(
    async (code: string) => {
      if (!challenge) return
      setError('')
      setLoading(true)
      try {
        const res = await verifyEmailOtp(challenge.challengeId, code)
        if (res.stage === 'totp') {
          setStep('totp')
          setNotice('Enter the 6-digit code from your authenticator app.')
        } else if (res.user) {
          finish(res.user, Boolean(res.suggestTotpSetup))
        }
      } catch (err) {
        setError(message(err))
      } finally {
        setLoading(false)
      }
    },
    [challenge, finish]
  )

  /** Layer 2 — authenticator code, or a recovery code. */
  const submitTotpCode = useCallback(
    async (code: string) => {
      if (!challenge) return
      setError('')
      setLoading(true)
      try {
        const res = await verifyTotp(challenge.challengeId, code)
        if (res.user) {
          if (typeof res.recoveryCodesRemaining === 'number') {
            setNotice(
              `Recovery code used — ${res.recoveryCodesRemaining} left. Set up a new authenticator soon.`
            )
          }
          finish(res.user, false)
        }
      } catch (err) {
        setError(message(err))
      } finally {
        setLoading(false)
      }
    },
    [challenge, finish]
  )

  const resend = useCallback(async () => {
    if (!challenge || resendIn > 0) return
    setError('')
    setLoading(true)
    try {
      applyChallenge(await resendEmailOtp(challenge.challengeId))
    } catch (err) {
      setError(message(err))
    } finally {
      setLoading(false)
    }
  }, [challenge, resendIn, applyChallenge])

  // ── Enrolment ───────────────────────────────────────────────────────────────

  const beginEnroll = useCallback(async () => {
    if (!user) return
    setError('')
    setLoading(true)
    try {
      setSetup(await startTotpSetup(user.token))
    } catch (err) {
      setError(message(err))
    } finally {
      setLoading(false)
    }
  }, [user])

  const confirmEnroll = useCallback(
    async (code: string) => {
      if (!user) return
      setError('')
      setLoading(true)
      try {
        const { recoveryCodes: codes } = await enableTotp(user.token, code)
        setRecoveryCodes(codes)
        setUser({ ...user, totpEnabled: true })
      } catch (err) {
        setError(message(err))
      } finally {
        setLoading(false)
      }
    },
    [user]
  )

  /** Leave the enrolment step — signed in either way. */
  const finishEnroll = useCallback(() => {
    if (!user) return
    setStep('done')
    onComplete?.(recoveryCodes ? { ...user, totpEnabled: true } : user)
  }, [user, recoveryCodes, onComplete])

  const goToGoogle = useCallback(() => {
    setError('')
    window.location.href = googleSignInUrl()
  }, [])

  // Coming back from Google: swap the one-time code for a session, or land on
  // the authenticator step if this account has one.
  const redeemed = useRef(false)
  useEffect(() => {
    if (!handoff || redeemed.current) return
    redeemed.current = true
    setLoading(true)
    redeemHandoff(handoff)
      .then((res) => {
        if (res.stage === 'totp' && res.challengeId) {
          setChallenge({
            challengeId: res.challengeId,
            stage: 'totp',
            email: '',
            factors: ['email_otp', 'totp'],
            expiresInSeconds: 0,
            emailSent: true,
          })
          setStep('totp')
          setNotice('Enter the 6-digit code from your authenticator app.')
        } else if (res.user) {
          finish(res.user, Boolean(res.suggestTotpSetup))
        }
      })
      .catch((err) => setError(message(err)))
      .finally(() => setLoading(false))
  }, [handoff, finish])

  const switchMode = useCallback((next: AuthMode) => {
    setMode(next)
    setStep('credentials')
    setChallenge(null)
    setError('')
    setNotice('')
  }, [])

  const backToCredentials = useCallback(() => {
    setChallenge(null)
    setStep('credentials')
    setError('')
    setNotice('')
  }, [])

  return {
    mode,
    step,
    googleAvailable,
    goToGoogle,
    challenge,
    user,
    error,
    notice,
    loading,
    expiresIn,
    resendIn,
    setup,
    recoveryCodes,
    submitCredentials,
    submitEmailCode,
    submitTotpCode,
    resend,
    beginEnroll,
    confirmEnroll,
    finishEnroll,
    switchMode,
    backToCredentials,
    setError,
  }
}

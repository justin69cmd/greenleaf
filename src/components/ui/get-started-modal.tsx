import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, KeyRound, Mail, ShieldCheck, Smartphone, X } from 'lucide-react'
import CodeInput from '@/components/ui/code-input'
import { useAuthFlow } from '@/hooks/useAuthFlow'

export interface AuthUser {
  name: string
  email: string
  token: string
  totpEnabled?: boolean
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-emerald-400/60'

const buttonCls =
  'glow-border w-full rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-sm font-medium text-emerald-50 backdrop-blur-md transition-colors hover:bg-emerald-400/25 disabled:opacity-40'

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.2-3.8 6.6-9.5 6.6-15.7"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 41 15.4 46 24 46"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.4 10z"
      />
      <path
        fill="#EA4335"
        d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 7.9 7 4.4 14l7.1 5.5c1.8-5.3 6.7-9 12.5-9"
      />
    </svg>
  )
}

// Two dots that show which layer of the sign-in is in play.
function LayerTrail({ active }: { active: 1 | 2 }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
      <span className={active >= 1 ? 'text-emerald-300' : ''}>Layer 1 · email</span>
      <span className="text-neutral-700">—</span>
      <span className={active >= 2 ? 'text-emerald-300' : ''}>Layer 2 · authenticator</span>
    </div>
  )
}

export default function GetStartedModal({
  onClose,
  onSuccess,
  handoff,
  initialError,
}: {
  onClose: () => void
  onSuccess?: (user: AuthUser) => void
  /** One-time code left in the URL by Google's callback. */
  handoff?: string
  /** Message from a Google sign-in that failed or was cancelled. */
  initialError?: string
}) {
  const auth = useAuthFlow(
    (user) => {
      setTimeout(() => (onSuccess ? onSuccess(user as AuthUser) : onClose()), 1100)
    },
    'login',
    handoff
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [copied, setCopied] = useState('')

  // Surface a failure Google reported on its way back.
  useEffect(() => {
    if (initialError) auth.setError(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // Each step asks for a different code — never carry the previous one over.
  useEffect(() => {
    setCode('')
    setRecoveryCode('')
  }, [auth.step, auth.setup])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1600)
    } catch {
      /* clipboard blocked — the value is on screen anyway */
    }
  }

  const stepCode = (next: string, submit: (c: string) => void) => {
    setCode(next)
    if (next.length === 6) submit(next)
  }

  const restart = () => {
    setCode('')
    setRecoveryCode('')
    setUseRecovery(false)
    auth.backToCredentials()
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="menu-overlay fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-neutral-950/90 p-7 shadow-2xl"
        style={{ boxShadow: '0 0 30px rgba(16,185,129,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Step 0: credentials ─────────────────────────────────────────── */}
        {auth.step === 'credentials' && (
          <>
            <h2 className="font-classy text-2xl italic text-white">
              {auth.mode === 'login' ? 'Welcome back' : 'Join GreenLeaf'}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {auth.mode === 'login' ? 'Sign in to your planner.' : 'Create your free account.'}
            </p>

            {auth.googleAvailable && (
              <>
                <button
                  onClick={auth.goToGoogle}
                  disabled={auth.loading}
                  className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/95 py-2.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white disabled:opacity-40"
                >
                  <GoogleMark />
                  Continue with Google
                </button>
                <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-neutral-600">
                  <span className="h-px flex-1 bg-white/10" />
                  or
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              </>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!email || !password || auth.loading) return
                auth.submitCredentials({ email, password, name })
              }}
              className="mt-4 space-y-3"
            >
              {auth.mode === 'signup' && (
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              )}
              <input
                type="email"
                autoComplete="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
              <input
                type="password"
                autoComplete={auth.mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />

              {auth.error && <p className="text-sm text-red-400/90">{auth.error}</p>}

              <button type="submit" disabled={!email || !password || auth.loading} className={buttonCls}>
                {auth.loading ? 'One moment…' : auth.mode === 'login' ? 'Continue' : 'Create account'}
              </button>
            </form>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/70" />
              Protected by two-factor sign-in
            </p>

            <p className="mt-3 text-center text-sm text-neutral-400">
              {auth.mode === 'login' ? 'New here? ' : 'Already have an account? '}
              <button
                onClick={() => auth.switchMode(auth.mode === 'login' ? 'signup' : 'login')}
                className="font-medium text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
              >
                {auth.mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </>
        )}

        {/* ── Layer 1: emailed one-time code ──────────────────────────────── */}
        {auth.step === 'email_otp' && (
          <>
            <Mail className="h-6 w-6 text-emerald-400" />
            <h2 className="mt-3 font-classy text-2xl italic text-white">Check your email</h2>
            <p className="mt-1 text-sm text-neutral-400">{auth.notice}</p>

            <div className="mt-5">
              <CodeInput
                value={code}
                onChange={(v) => stepCode(v, auth.submitEmailCode)}
                disabled={auth.loading}
              />
            </div>

            {auth.error && <p className="mt-3 text-center text-sm text-red-400/90">{auth.error}</p>}

            <button
              onClick={() => auth.submitEmailCode(code)}
              disabled={code.length !== 6 || auth.loading}
              className={`mt-4 ${buttonCls}`}
            >
              {auth.loading ? 'Checking…' : 'Verify code'}
            </button>

            <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
              <button
                onClick={auth.resend}
                disabled={auth.resendIn > 0 || auth.loading}
                className="text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300 disabled:text-neutral-600 disabled:no-underline"
              >
                {auth.resendIn > 0 ? `Resend in ${auth.resendIn}s` : 'Resend code'}
              </button>
              <span>{auth.expiresIn > 0 ? `Expires in ${mmss(auth.expiresIn)}` : 'Code expired'}</span>
            </div>

            <LayerTrail active={1} />

            <button
              onClick={restart}
              className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Use a different account
            </button>
          </>
        )}

        {/* ── Layer 2: authenticator code ─────────────────────────────────── */}
        {auth.step === 'totp' && (
          <>
            <Smartphone className="h-6 w-6 text-emerald-400" />
            <h2 className="mt-3 font-classy text-2xl italic text-white">One more layer</h2>
            <p className="mt-1 text-sm text-neutral-400">
              {useRecovery
                ? 'Enter one of the recovery codes you saved.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </p>

            <div className="mt-5">
              {useRecovery ? (
                <input
                  type="text"
                  placeholder="XXXXX-XXXXX"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && auth.submitTotpCode(recoveryCode)}
                  className={`${inputCls} text-center font-mono tracking-[0.2em]`}
                />
              ) : (
                <CodeInput
                  value={code}
                  onChange={(v) => stepCode(v, auth.submitTotpCode)}
                  disabled={auth.loading}
                />
              )}
            </div>

            {auth.error && <p className="mt-3 text-center text-sm text-red-400/90">{auth.error}</p>}

            <button
              onClick={() => auth.submitTotpCode(useRecovery ? recoveryCode : code)}
              disabled={auth.loading || (useRecovery ? recoveryCode.length < 10 : code.length !== 6)}
              className={`mt-4 ${buttonCls}`}
            >
              {auth.loading ? 'Checking…' : 'Verify and sign in'}
            </button>

            <button
              onClick={() => {
                setUseRecovery(!useRecovery)
                setCode('')
                setRecoveryCode('')
                auth.setError('')
              }}
              className="mt-3 w-full text-center text-xs text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
            >
              {useRecovery ? 'Use my authenticator app instead' : "Lost your phone? Use a recovery code"}
            </button>

            <LayerTrail active={2} />
          </>
        )}

        {/* ── Optional enrolment, once the session exists ─────────────────── */}
        {auth.step === 'enroll' && (
          <>
            {auth.recoveryCodes ? (
              <>
                <KeyRound className="h-6 w-6 text-emerald-400" />
                <h2 className="mt-3 font-classy text-2xl italic text-white">Save these codes</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Each one signs you in once if you lose your phone. This is the only time they're
                  shown.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-xs text-emerald-100/90">
                  {auth.recoveryCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <button
                  onClick={() => copy(auth.recoveryCodes!.join('\n'), 'codes')}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-white"
                >
                  {copied === 'codes' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy all
                    </>
                  )}
                </button>
                <button onClick={auth.finishEnroll} className={`mt-4 ${buttonCls}`}>
                  I've saved them — continue
                </button>
              </>
            ) : auth.setup ? (
              <>
                <Smartphone className="h-6 w-6 text-emerald-400" />
                <h2 className="mt-3 font-classy text-2xl italic text-white">Scan this</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Add it to Google Authenticator, Authy, 1Password — anything that does TOTP.
                </p>
                <img
                  src={auth.setup.qrDataUrl}
                  alt="Authenticator QR code"
                  className="mx-auto mt-4 h-40 w-40 rounded-xl bg-white p-2"
                />
                <button
                  onClick={() => copy(auth.setup!.secret, 'secret')}
                  className="mx-auto mt-3 flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-neutral-400 transition-colors hover:text-white"
                >
                  {copied === 'secret' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {auth.setup.secret}
                </button>
                <p className="mt-4 text-center text-sm text-neutral-400">
                  Then enter the code it shows:
                </p>
                <div className="mt-3">
                  <CodeInput
                    value={code}
                    onChange={(v) => stepCode(v, auth.confirmEnroll)}
                    disabled={auth.loading}
                  />
                </div>
                {auth.error && (
                  <p className="mt-3 text-center text-sm text-red-400/90">{auth.error}</p>
                )}
                <button
                  onClick={() => auth.confirmEnroll(code)}
                  disabled={code.length !== 6 || auth.loading}
                  className={`mt-4 ${buttonCls}`}
                >
                  {auth.loading ? 'Verifying…' : 'Turn on authenticator'}
                </button>
                <button
                  onClick={auth.finishEnroll}
                  className="mt-3 w-full text-center text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Skip for now
                </button>
              </>
            ) : (
              <>
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
                <h2 className="mt-3 font-classy text-2xl italic text-white">Add a second layer</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Your email code protects this account. An authenticator app adds a second,
                  offline layer that keeps working even if your inbox is compromised.
                </p>
                {auth.error && <p className="mt-3 text-sm text-red-400/90">{auth.error}</p>}
                <button
                  onClick={auth.beginEnroll}
                  disabled={auth.loading}
                  className={`mt-5 ${buttonCls}`}
                >
                  {auth.loading ? 'Preparing…' : 'Set up authenticator'}
                </button>
                <button
                  onClick={auth.finishEnroll}
                  className="mt-3 w-full text-center text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Not now — you can turn it on in Settings
                </button>
              </>
            )}
          </>
        )}

        {/* ── Done ────────────────────────────────────────────────────────── */}
        {auth.step === 'done' && auth.user && (
          <div className="py-8 text-center">
            <div className="mb-3 text-3xl">🌿</div>
            <p className="font-medium text-white">
              {auth.mode === 'login'
                ? `Welcome back, ${auth.user.name.split(' ')[0]}!`
                : `Welcome to GreenLeaf, ${auth.user.name.split(' ')[0]}!`}
            </p>
            {auth.user.totpEnabled && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-emerald-300/80">
                <ShieldCheck className="h-3.5 w-3.5" /> Two-factor protection is on
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

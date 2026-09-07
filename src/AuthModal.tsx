import { useEffect, useState } from 'react'
import { X, ShieldCheck } from 'lucide-react'
import CodeInput from '@/components/ui/code-input'
import { useAuthFlow } from '@/hooks/useAuthFlow'
import type { User } from './api'

interface Props {
  initialMode?: 'login' | 'signup'
  onClose: () => void
  onAuth: (user: User) => void
}

// Sign-in walks two layers — emailed one-time code, then an authenticator code
// for accounts that enrolled one. The shared hook owns that state machine; this
// component is just the chrome around it.
export default function AuthModal({ initialMode = 'login', onClose, onAuth }: Props) {
  const auth = useAuthFlow((user) => {
    onAuth(user)
    setTimeout(onClose, 1100)
  }, initialMode)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  // The emailed code and the authenticator code are different fields.
  useEffect(() => setCode(''), [auth.step])

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors'

  const onCode = (value: string, submit: (c: string) => void) => {
    setCode(value)
    if (value.length === 6) submit(value)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="liquid-glass rounded-2xl p-8 w-full max-w-sm relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        {auth.step === 'done' && auth.user ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✓</div>
            <p className="text-white font-medium">
              {auth.mode === 'login' ? 'Welcome back!' : 'Account created!'}
            </p>
          </div>
        ) : auth.step === 'credentials' ? (
          <>
            <h2 className="text-white text-xl font-medium mb-1">
              {auth.mode === 'login' ? 'Welcome back' : 'Get started'}
            </h2>
            <p className="text-white/50 text-sm mb-6">
              {auth.mode === 'login'
                ? 'Sign in to your Equilibrium account'
                : 'Create your Equilibrium account'}
            </p>
            <div className="space-y-3">
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
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
              <input
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && auth.submitCredentials({ email, password, name })
                }
                className={inputCls}
              />
            </div>

            {auth.error && (
              <p className="mt-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {auth.error}
              </p>
            )}

            <button
              onClick={() => auth.submitCredentials({ email, password, name })}
              disabled={auth.loading || !email || !password}
              className="mt-4 w-full btn-gold text-sm font-medium py-3 rounded-full transition-colors disabled:opacity-40"
            >
              {auth.loading ? 'Please wait…' : auth.mode === 'login' ? 'Continue' : 'Create account'}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-white/40">
              <ShieldCheck size={13} /> Protected by two-factor sign-in
            </p>
            <p className="mt-4 text-center text-sm text-white/40">
              {auth.mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => auth.switchMode(auth.mode === 'login' ? 'signup' : 'login')}
                className="text-white/70 hover:text-white transition-colors underline underline-offset-2"
              >
                {auth.mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </>
        ) : auth.step === 'enroll' ? (
          <>
            <h2 className="text-white text-xl font-medium mb-1">You're in</h2>
            <p className="text-white/50 text-sm mb-6">
              Add an authenticator app in Settings for a second, offline layer of protection.
            </p>
            <button
              onClick={auth.finishEnroll}
              className="w-full btn-gold text-sm font-medium py-3 rounded-full transition-colors"
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <h2 className="text-white text-xl font-medium mb-1">
              {auth.step === 'email_otp' ? 'Check your email' : 'Authenticator code'}
            </h2>
            <p className="text-white/50 text-sm mb-6">{auth.notice}</p>

            <CodeInput
              value={code}
              onChange={(v) =>
                onCode(v, auth.step === 'email_otp' ? auth.submitEmailCode : auth.submitTotpCode)
              }
              disabled={auth.loading}
            />

            {auth.error && (
              <p className="mt-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {auth.error}
              </p>
            )}

            <button
              onClick={() =>
                auth.step === 'email_otp' ? auth.submitEmailCode(code) : auth.submitTotpCode(code)
              }
              disabled={auth.loading || code.length !== 6}
              className="mt-4 w-full btn-gold text-sm font-medium py-3 rounded-full transition-colors disabled:opacity-40"
            >
              {auth.loading ? 'Checking…' : 'Verify code'}
            </button>

            {auth.step === 'email_otp' && (
              <div className="mt-3 flex items-center justify-between text-xs text-white/40">
                <button
                  onClick={auth.resend}
                  disabled={auth.resendIn > 0 || auth.loading}
                  className="underline underline-offset-2 hover:text-white disabled:no-underline disabled:text-white/25"
                >
                  {auth.resendIn > 0 ? `Resend in ${auth.resendIn}s` : 'Resend code'}
                </button>
                <button
                  onClick={() => {
                    setCode('')
                    auth.backToCredentials()
                  }}
                  className="hover:text-white"
                >
                  Start over
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

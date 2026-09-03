import { useState } from 'react'
import { X } from 'lucide-react'

type Mode = 'login' | 'signup'

export interface AuthUser {
  name: string
  email: string
  token: string
}

const API = 'https://greenleaf-backend.vercel.app/'

export default function GetStartedModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess?: (user: AuthUser) => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [doneUser, setDoneUser] = useState<AuthUser | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || loading) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/${mode === 'login' ? 'login' : 'signup'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { name, email, password }),
      })
      const data = (await res.json()) as AuthUser & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      setDoneUser(data)
      setTimeout(() => (onSuccess ? onSuccess(data) : onClose()), 1100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('fetch') ? 'Could not reach the server — is it running?' : msg)
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-emerald-400/60'

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

        {doneUser ? (
          <div className="py-8 text-center">
            <div className="mb-3 text-3xl">🌿</div>
            <p className="font-medium text-white">
              {mode === 'login'
                ? `Welcome back, ${doneUser.name.split(' ')[0]}!`
                : `Welcome to GreenLeaf, ${doneUser.name.split(' ')[0]}!`}
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-classy text-2xl italic text-white">
              {mode === 'login' ? 'Welcome back' : 'Join GreenLeaf'}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {mode === 'login' ? 'Sign in to your planner.' : 'Create your free account.'}
            </p>

            <form onSubmit={submit} className="mt-5 space-y-3">
              {mode === 'signup' && (
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
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />

              {error && <p className="text-sm text-red-400/90">{error}</p>}

              <button
                type="submit"
                disabled={!email || !password || loading}
                className="glow-border w-full rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-sm font-medium text-emerald-50 backdrop-blur-md transition-colors hover:bg-emerald-400/25 disabled:opacity-40"
              >
                {loading ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-neutral-400">
              {mode === 'login' ? 'New here? ' : 'Already have an account? '}
              <button
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login')
                  setError('')
                }}
                className="font-medium text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
              >
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

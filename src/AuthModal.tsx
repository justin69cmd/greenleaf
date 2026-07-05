import { useState } from 'react'
import { X } from 'lucide-react'
import { authRequest, type User } from './api'

type Mode = 'login' | 'signup'
interface Props {
  initialMode?: Mode
  onClose: () => void
  onAuth: (user: User) => void
}

export default function AuthModal({ initialMode = 'login', onClose, onAuth }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async () => {
    if (!email || !password) return
    setLoading(true)
    setError('')
    try {
      const body: Record<string, string> = { email, password }
      if (mode === 'signup') body.name = name
      const user = await authRequest(mode, body)
      setDone(true)
      onAuth(user)
      setTimeout(onClose, 1100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
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
        {done ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✓</div>
            <p className="text-white font-medium">
              {mode === 'login' ? 'Welcome back!' : 'Account created!'}
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-white text-xl font-medium mb-1">
              {mode === 'login' ? 'Welcome back' : 'Get started'}
            </h2>
            <p className="text-white/50 text-sm mb-6">
              {mode === 'login'
                ? 'Sign in to your Equilibrium account'
                : 'Create your Equilibrium account'}
            </p>
            <div className="space-y-3">
              {mode === 'signup' && (
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                />
              )}
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
              />
              <input
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !email || !password}
              className="mt-4 w-full btn-gold text-sm font-medium py-3 rounded-full transition-colors disabled:opacity-40"
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
            <p className="mt-4 text-center text-sm text-white/40">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login')
                  setError('')
                }}
                className="text-white/70 hover:text-white transition-colors underline underline-offset-2"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

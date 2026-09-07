import { useEffect, useState } from 'react'
import { Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import CodeInput from '@/components/ui/code-input'
import {
  disableTotp,
  enableTotp,
  fetchAccount,
  startTotpSetup,
  type AccountStatus,
  type TotpSetup,
} from '@/api'

// SQLite hands back UTC timestamps as "YYYY-MM-DD HH:MM:SS".
function shortDate(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Manage the second layer after sign-in: enrol an authenticator, see how many
// recovery codes are left, or turn it back off with the account password.
// The first layer (emailed code) is always on and has nothing to configure.
export default function TwoFactorSettings({ token }: { token: string }) {
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [panel, setPanel] = useState<'idle' | 'enroll' | 'disable'>('idle')
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchAccount(token).then(setStatus).catch(() => setStatus(null))
  }, [token])

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setLoading(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const startEnroll = () =>
    run(async () => {
      setSetup(await startTotpSetup(token))
      setPanel('enroll')
    })

  const confirm = (value: string) =>
    run(async () => {
      const { recoveryCodes: codes } = await enableTotp(token, value)
      setRecoveryCodes(codes)
      setStatus((s) => (s ? { ...s, totpEnabled: true, recoveryCodesRemaining: codes.length } : s))
      setCode('')
    })

  const turnOff = () =>
    run(async () => {
      await disableTotp(token, password)
      setStatus((s) => (s ? { ...s, totpEnabled: false, recoveryCodesRemaining: 0 } : s))
      setPanel('idle')
      setPassword('')
      setSetup(null)
      setRecoveryCodes(null)
    })

  if (!status) return null

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        {status.totpEnabled ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/80" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Two-factor sign-in</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Layer 1 — emailed code · always on
            <br />
            Layer 2 — authenticator app ·{' '}
            {status.totpEnabled ? (
              <span className="text-emerald-300">
                on ({status.recoveryCodesRemaining} recovery code
                {status.recoveryCodesRemaining === 1 ? '' : 's'} left)
              </span>
            ) : (
              <span className="text-amber-300/90">off</span>
            )}
          </p>
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Member since {shortDate(status.createdAt)}
            {status.lastLoginAt ? ` · last signed in ${shortDate(status.lastLoginAt)}` : ''}
          </p>
          {status.googleLinked && (
            <p className="mt-1 text-[11px] text-neutral-500">
              Linked to Google{status.hasPassword ? ' · password also set' : ' · no password set'}
            </p>
          )}
        </div>
      </div>

      {recoveryCodes ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-emerald-100/90">
            {recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(recoveryCodes.join('\n'))
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              } catch {
                /* clipboard blocked — codes are on screen */
              }
            }}
            className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-white"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy recovery codes'}
          </button>
          <button
            onClick={() => {
              setRecoveryCodes(null)
              setSetup(null)
              setPanel('idle')
            }}
            className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-neutral-300 transition-colors hover:text-white"
          >
            Done
          </button>
        </>
      ) : panel === 'enroll' && setup ? (
        <>
          <img
            src={setup.qrDataUrl}
            alt="Authenticator QR code"
            className="mx-auto mt-3 h-32 w-32 rounded-lg bg-white p-1.5"
          />
          <p className="mt-2 text-center font-mono text-[11px] text-neutral-400">{setup.secret}</p>
          <div className="mt-3">
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v)
                if (v.length === 6) confirm(v)
              }}
              disabled={loading}
            />
          </div>
          <button
            onClick={() => setPanel('idle')}
            className="mt-3 w-full text-center text-xs text-neutral-500 transition-colors hover:text-neutral-300"
          >
            Cancel
          </button>
        </>
      ) : panel === 'disable' ? (
        <>
          <input
            type={status.hasPassword ? 'password' : 'text'}
            inputMode={status.hasPassword ? undefined : 'numeric'}
            placeholder={
              status.hasPassword ? 'Confirm your password' : 'Current authenticator code'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && turnOff()}
            className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-emerald-400/60"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={turnOff}
              disabled={!password || loading}
              className="flex-1 rounded-lg border border-red-400/25 bg-red-400/10 py-2 text-xs text-red-200 transition-colors hover:border-red-400/50 disabled:opacity-40"
            >
              Turn off
            </button>
            <button
              onClick={() => setPanel('idle')}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-neutral-300 transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={() => (status.totpEnabled ? setPanel('disable') : startEnroll())}
          disabled={loading}
          className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-neutral-300 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
        >
          {loading
            ? 'One moment…'
            : status.totpEnabled
              ? 'Turn off authenticator'
              : 'Set up authenticator app'}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-400/90">{error}</p>}
    </div>
  )
}

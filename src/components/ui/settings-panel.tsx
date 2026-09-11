import { useState } from 'react'
import { X, LogOut, Trash2, CalendarClock } from 'lucide-react'
import SchedulesPanel from './schedules-panel'
import TwoFactorSettings from './two-factor-settings'
import type { AuthUser } from './get-started-modal'

export default function SettingsPanel({
  user,
  onClose,
  onSignOut,
}: {
  user: AuthUser | null
  onClose: () => void
  onSignOut: () => void
}) {
  const [showSchedules, setShowSchedules] = useState(false)

  const clearChat = () => {
    localStorage.removeItem('greenleaf-chat')
    onClose()
  }

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
          aria-label="Close settings"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="font-classy text-2xl italic text-white">Settings</h2>

        {user ? (
          <>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{user.email}</p>
            </div>

            <TwoFactorSettings token={user.token} />

            <div className="mt-4 space-y-2">
              <button
                onClick={() => setShowSchedules(true)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:border-white/25 hover:text-white"
              >
                <CalendarClock className="h-4 w-4" />
                Schedules
              </button>
              <button
                onClick={clearChat}
                className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:border-white/25 hover:text-white"
              >
                <Trash2 className="h-4 w-4" />
                Clear chat history
              </button>
              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-2.5 rounded-xl border border-red-400/25 bg-red-400/5 px-4 py-2.5 text-sm text-red-300/90 transition-colors hover:border-red-400/50 hover:text-red-200"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        ) : (
          <p className="mt-5 text-sm text-neutral-400">
            You're not signed in yet — hit <span className="text-emerald-300">Get started</span> on
            the home page to create your planner.
          </p>
        )}
      </div>

      {showSchedules && user && (
        <SchedulesPanel token={user.token} onClose={() => setShowSchedules(false)} />
      )}
    </div>
  )
}

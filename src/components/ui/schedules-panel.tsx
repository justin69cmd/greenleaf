import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, Loader2, Play, Plus, Power, Trash2, X } from 'lucide-react'
import {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  runScheduleNow,
  setScheduleEnabled,
  type Cadence,
  type Schedule,
} from '@/api'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PRESETS = [
  { label: 'Plan my week', goal: 'Using my own goals and past plans, lay out my week ahead: priorities first, then a realistic day-by-day breakdown. This is about my personal schedule — do not report news or world events.', cadence: 'weekly' as Cadence, weekday: 0, hour: 20 },
  { label: 'Daily focus', goal: 'From my own plans and goals, pick the three tasks I should do today and one to drop. This is about my personal to-do list — do not report news or world events.', cadence: 'weekdays' as Cadence, weekday: 1, hour: 8 },
  { label: 'Weekly review', goal: 'Review the plans I made this week against what I set out to do, and suggest what to change next week. Personal review only — no news or world events.', cadence: 'weekly' as Cadence, weekday: 5, hour: 17 },
]

/** How a schedule reads in plain English, in the viewer's own timezone. */
function describe(s: Schedule): string {
  const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
  const when =
    s.cadence === 'daily' ? 'Every day' : s.cadence === 'weekdays' ? 'Weekdays' : `Every ${DAYS[s.weekday ?? 0]}`
  return `${when} at ${time}`
}

export default function SchedulesPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  // New-schedule form.
  const [goal, setGoal] = useState('')
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [weekday, setWeekday] = useState(0)
  const [hour, setHour] = useState(20)
  const [byEmail, setByEmail] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSchedules(await fetchSchedules(token))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your schedules.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!goal.trim()) return
    setBusyId(-1)
    try {
      await createSchedule(token, { goal, cadence, weekday, hour, delivery: byEmail ? 'email' : 'screen' })
      setGoal('')
      setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that schedule.')
    } finally {
      setBusyId(null)
    }
  }

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusyId(null)
    }
  }

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div
      className="menu-overlay fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-emerald-400/30 bg-neutral-950/95 p-7 shadow-2xl"
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

        <h2 className="flex items-center gap-2 font-classy text-2xl italic text-white">
          <CalendarClock className="h-5 w-5 text-emerald-400" />
          Schedules
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Runs that happen without you. Times are in {zone}.
        </p>

        <div className="mt-5 flex-1 space-y-2 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && schedules.length === 0 && (
            <p className="py-6 text-center text-sm text-neutral-500">
              Nothing scheduled yet.
            </p>
          )}

          <AnimatePresence initial={false}>
            {schedules.map((s) => (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={`rounded-xl border px-4 py-3 ${
                  s.enabled ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/[0.02] opacity-60'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{s.title}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {describe(s)} · {s.delivery === 'email' ? `emailed to ${s.email}` : 'saved to history'}
                    </p>
                    {s.lastStatus && (
                      <p className="mt-1 text-[11px] text-neutral-600">
                        Last run {s.lastFiredOn}: {s.lastStatus}
                      </p>
                    )}
                  </div>

                  {busyId === s.id ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-300" />
                  ) : (
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        onClick={() => void act(s.id, () => runScheduleNow(token, s.id))}
                        title="Run now"
                        className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-emerald-500/15 hover:text-emerald-300"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void act(s.id, () => setScheduleEnabled(token, s.id, !s.enabled))}
                        title={s.enabled ? 'Pause' : 'Resume'}
                        className={`rounded-lg p-1.5 transition-colors hover:bg-white/10 ${
                          s.enabled ? 'text-emerald-400/70' : 'text-white/30'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void act(s.id, () => deleteSchedule(token, s.id))}
                        title="Delete"
                        className="rounded-lg p-1.5 text-white/25 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {error && <p className="mt-3 text-sm text-red-400/90">{error}</p>}

        {adding ? (
          <div className="mt-4 space-y-2.5 border-t border-white/10 pt-4">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setGoal(p.goal)
                    setCadence(p.cadence)
                    setWeekday(p.weekday)
                    setHour(p.hour)
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 transition-colors hover:border-emerald-400/40 hover:text-white"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="What should it do, every time it runs?"
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-emerald-400/60"
            />

            <div className="flex flex-wrap gap-2">
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Cadence)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>

              {cadence === 'weekly' && (
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={byEmail}
                  onChange={(e) => setByEmail(e.target.checked)}
                  className="accent-emerald-400"
                />
                Email the PDF
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={add}
                disabled={!goal.trim() || busyId === -1}
                className="glow-border flex-1 rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-400/25 disabled:opacity-40"
              >
                {busyId === -1 ? 'Saving…' : 'Create schedule'}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded-full border border-white/10 px-4 text-sm text-neutral-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-4 flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-2.5 text-sm text-neutral-300 transition-colors hover:border-emerald-400/40 hover:text-white"
          >
            <Plus className="h-4 w-4" /> New schedule
          </button>
        )}
      </div>
    </div>
  )
}

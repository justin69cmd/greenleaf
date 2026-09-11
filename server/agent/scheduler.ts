import * as db from '../db.js'
import { planTasks } from './planner.js'
import { executeRun } from './run.js'
import { recall, recallBlock } from './memory.js'
import type { WSMessage } from '../types.js'

// ── Recurring runs ────────────────────────────────────────────────────────────
// A minute-resolution loop: every tick, any enabled schedule whose local time
// has arrived and which hasn't already fired today gets run through the same
// pipeline as the chat.
//
// Cadence is stored in the customer's own timezone rather than as a UTC
// timestamp, so "8pm every Sunday" survives daylight-saving shifts. The guard
// against double-firing is the local calendar date, which also means a server
// restart mid-day cannot replay a schedule that already ran.
//
// This needs a process that stays alive. On a serverless host (where every
// request is a fresh instance and nothing runs between them) the loop never
// ticks — deploy the backend somewhere with a persistent process, or drive
// `runDueSchedules()` from an external cron hitting POST /schedules/tick.

const TICK_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null

/** The wall-clock parts of `when` as seen in `timeZone`. */
function localParts(when: Date, timeZone: string) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
    const parts = Object.fromEntries(fmt.formatToParts(when).map((p) => [p.type, p.value]))
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      weekday: weekdays.indexOf(parts.weekday ?? 'Sun'),
    }
  } catch {
    // An invalid timezone shouldn't wedge the whole loop — fall back to UTC.
    return {
      date: when.toISOString().slice(0, 10),
      hour: when.getUTCHours(),
      minute: when.getUTCMinutes(),
      weekday: when.getUTCDay(),
    }
  }
}

function cadenceMatches(row: db.ScheduleRow, weekday: number): boolean {
  if (row.cadence === 'daily') return true
  if (row.cadence === 'weekdays') return weekday >= 1 && weekday <= 5
  return weekday === row.weekday
}

export function isDue(row: db.ScheduleRow, now = new Date()): boolean {
  const local = localParts(now, row.timezone)
  if (row.last_fired_on === local.date) return false
  if (!cadenceMatches(row, local.weekday)) return false
  // Fire at or after the chosen minute, so a tick that lands a little late (or
  // a server that was asleep at the exact minute) still runs it that day.
  return local.hour * 60 + local.minute >= row.hour * 60 + row.minute
}

/** Run one schedule now, whatever the clock says. Used by the runner and "Run now". */
export async function fireSchedule(row: db.ScheduleRow): Promise<{ runId?: string; status: string }> {
  const owner = db.findUserById(row.user_id)
  if (!owner) return { status: 'no such account' }

  const localDate = localParts(new Date(), row.timezone).date
  // Claim the slot before the work starts: a long run must not be started
  // twice by the next tick.
  db.markScheduleFired(row.id, localDate, null, 'running')

  const log: string[] = []
  const sink = (msg: WSMessage) => {
    if (msg.type === 'log') log.push(String(msg.payload))
  }

  try {
    const memories = recall(owner.email, row.goal)
    const memoryBlock = memories.length ? recallBlock(memories) : undefined
    const tasks = await planTasks(row.goal, memoryBlock)
    const outcome = await executeRun({
      goal: row.goal,
      title: row.title,
      tasks,
      user: owner.email,
      delivery: row.delivery,
      email: row.email || owner.email,
      memoryBlock,
      send: sink,
    })
    const status = outcome.emailOk === false ? `sent, but email failed: ${outcome.emailInfo}` : 'done'
    db.markScheduleFired(row.id, localDate, outcome.runId, status)
    console.log(`⏰ Schedule "${row.title}" ran for ${owner.email} → ${status}`)
    return { runId: outcome.runId, status }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.markScheduleFired(row.id, localDate, null, `failed: ${message.slice(0, 200)}`)
    console.error(`⏰ Schedule "${row.title}" failed: ${message}`)
    return { status: `failed: ${message}` }
  }
}

/** One pass over every enabled schedule. Safe to call from a cron endpoint. */
export async function runDueSchedules(now = new Date()): Promise<number> {
  const due = db.allEnabledSchedules().filter((row) => isDue(row, now))
  // Sequential on purpose: these share the account's model quota, and a
  // scheduled run is never in a hurry.
  for (const row of due) await fireSchedule(row)
  return due.length
}

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    void runDueSchedules().catch((err) => console.error('[scheduler]', err))
  }, TICK_MS)
  // Don't hold the process open on its own account.
  timer.unref?.()
  console.log('⏰ Scheduler running (checks every minute)')
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

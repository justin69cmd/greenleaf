import { chatWithFallback, FAST_CHAIN } from './llm.js'
import type { CalendarEvent, BusySlot } from '../google.js'

// ── Plan → calendar events ────────────────────────────────────────────────────
// Two deliberate properties:
//
//   1. Extraction and writing are separate steps. This module only *proposes*
//      events; nothing reaches the customer's calendar until they have seen the
//      list and said yes. An agent silently writing to a real calendar is not
//      a feature anyone asked for.
//   2. The model is asked for times relative to a stated "today", because it
//      has no clock and will otherwise invent a date in the wrong year.

const EXTRACT_PROMPT = `You turn a written plan into calendar events.

Rules:
- Only include things that clearly happen at a time. Ignore advice, principles and general tips.
- Use the user's local dates. "Today" is given to you; work forward from it.
- Times are 24-hour, in the format YYYY-MM-DDTHH:MM:SS with no timezone suffix.
- Give every event a sensible duration (30-120 minutes). Never zero-length.
- Titles are short and concrete: "Revise chapter 4", not "Study session for the exam coming up".
- At most 12 events. If the plan has more, keep the most important.

Answer with JSON only, no prose, in exactly this shape:
{"events":[{"title":"...","start":"2026-09-14T09:00:00","end":"2026-09-14T10:30:00","notes":"..."}]}
If nothing in the plan is time-bound, answer {"events":[]}.`

export interface ProposedEvent extends CalendarEvent {
  /** Existing calendar entries this would overlap. */
  clashes?: BusySlot[]
}

function parseEvents(raw: string): CalendarEvent[] {
  // Models wrap JSON in fences often enough that trimming is worth it.
  const json = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = json.indexOf('{')
  const end = json.lastIndexOf('}')
  if (start === -1 || end === -1) return []
  try {
    const parsed = JSON.parse(json.slice(start, end + 1)) as { events?: unknown }
    if (!Array.isArray(parsed.events)) return []
    return parsed.events
      .map((e) => e as Record<string, unknown>)
      .filter((e) => typeof e.title === 'string' && typeof e.start === 'string' && typeof e.end === 'string')
      .map((e) => ({
        title: String(e.title).slice(0, 120),
        start: String(e.start),
        end: String(e.end),
        ...(typeof e.notes === 'string' ? { notes: String(e.notes).slice(0, 500) } : {}),
      }))
      .filter((e) => !Number.isNaN(Date.parse(e.start)) && Date.parse(e.end) > Date.parse(e.start))
      .slice(0, 12)
  } catch {
    return []
  }
}

/** Ask the model which parts of a plan belong on a calendar. */
export async function extractEvents(plan: string, today: string): Promise<CalendarEvent[]> {
  const { completion } = await chatWithFallback(
    {
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: `Today is ${today}.\n\nPlan:\n${plan.slice(0, 6000)}` },
      ],
      max_tokens: 900,
      temperature: 0,
    },
    undefined,
    FAST_CHAIN
  )
  return parseEvents(completion.choices[0]?.message?.content ?? '')
}

/** How far `timeZone` is from UTC at a given instant, in ms. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs))
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]))
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs
  )
}

/**
 * Proposed events carry wall-clock times with no zone ("2026-09-14T09:00:00"),
 * because that is what the customer means and what Google is told to use.
 * Comparing them with real bookings needs them resolved to instants in the
 * customer's zone — not the server's, which is what Date.parse would assume.
 */
export function toInstant(naive: string, timeZone: string): number {
  // Already carries a zone (a real booking): trust it.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(naive)) return Date.parse(naive)
  const guess = Date.parse(`${naive}Z`)
  if (Number.isNaN(guess)) return NaN
  try {
    // One refinement pass settles the DST-boundary cases.
    const first = guess - zoneOffset(guess, timeZone)
    return guess - zoneOffset(first, timeZone)
  } catch {
    return guess
  }
}

/** Flag proposed events that collide with something already booked. */
export function markClashes(
  events: CalendarEvent[],
  busy: BusySlot[],
  timeZone = 'UTC'
): ProposedEvent[] {
  return events.map((event) => {
    const start = toInstant(event.start, timeZone)
    const end = toInstant(event.end, timeZone)
    const clashes = busy.filter((slot) => {
      if (!slot.start || !slot.end) return false
      const bStart = toInstant(slot.start, timeZone)
      const bEnd = toInstant(slot.end, timeZone)
      return start < bEnd && bStart < end
    })
    return clashes.length ? { ...event, clashes } : event
  })
}

/** The window the proposed events span, padded, for the busy-time lookup. */
export function windowFor(events: CalendarEvent[], timeZone = 'UTC'): { min: string; max: string } | null {
  if (!events.length) return null
  const times = events.flatMap((e) => [toInstant(e.start, timeZone), toInstant(e.end, timeZone)])
  return {
    min: new Date(Math.min(...times) - 3_600_000).toISOString(),
    max: new Date(Math.max(...times) + 3_600_000).toISOString(),
  }
}

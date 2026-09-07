import { runsForUser } from './store.js'
import type { RunRecord } from '../types.js'

// ── Long-term memory across runs ──────────────────────────────────────────────
// Each websocket connection already remembers the current conversation. This
// layer is what the swarm remembers between conversations: when a new goal
// resembles work the same user has had done before, the earlier answer is
// retrieved and handed to the planner and the synthesizer as context.
//
// Retrieval is TF-IDF over the user's own run history — no embedding service,
// no extra API cost, and it stays honest about what it found (every recalled
// passage carries the run it came from).

const STOPWORDS = new Set(
  ('a about above after again all also am an and any are as at be because been before being below between both but by ' +
    'can could did do does doing down during each few for from further had has have having he her here hers him his how ' +
    'i if in into is it its just me more most my no nor not now of off on once only or other our out over own please ' +
    'same she should so some such than that the their them then there these they this those through to too under until ' +
    'up us use very was we were what when where which while who whom why will with would you your'
  ).split(' ')
)

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 24 && !STOPWORDS.has(w))
}

/** Bag of terms for one run — its title and goal count double, being the most topical parts. */
function runTerms(run: RunRecord): Map<string, number> {
  const bag = new Map<string, number>()
  const add = (text: string, weight: number) => {
    for (const term of tokenize(text)) bag.set(term, (bag.get(term) ?? 0) + weight)
  }
  add(run.title, 2)
  add(run.goal.slice(0, 400), 2)
  add(run.summary.slice(0, 2000), 1)
  return bag
}

export interface Recollection {
  runId: string
  title: string
  when: number
  score: number
  excerpt: string
}

/**
 * Find the past runs most related to `goal`.
 * Returns [] when there is no history or nothing clears the relevance floor —
 * an unrelated memory is worse than no memory, so the bar is deliberately high.
 */
export function recall(user: string, goal: string, limit = 2): Recollection[] {
  const history = runsForUser(user).filter((r) => r.status === 'done' && r.summary.trim().length > 80)
  if (history.length === 0) return []

  const queryTerms = new Set(tokenize(goal))
  if (queryTerms.size === 0) return []

  const bags = history.map(runTerms)

  // Document frequency, so shared boilerplate ("plan", "week") counts for less
  // than a distinctive term the two runs genuinely share.
  const df = new Map<string, number>()
  for (const bag of bags) {
    for (const term of bag.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const N = history.length

  const scored = history.map((run, i) => {
    const bag = bags[i]
    let score = 0
    for (const term of queryTerms) {
      const tf = bag.get(term)
      if (!tf) continue
      const idf = Math.log(1 + N / (df.get(term) ?? 1))
      score += Math.log(1 + tf) * idf
    }
    // Normalise by query length so long goals aren't scored higher by default.
    score /= Math.sqrt(queryTerms.size)
    // Gentle recency preference: a month-old run is worth ~10% less.
    const ageDays = (Date.now() - run.startedAt) / 86_400_000
    score *= 1 / (1 + ageDays / 300)
    return { run, score }
  })

  return scored
    .filter((s) => s.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ run, score }) => ({
      runId: run.id,
      title: run.title,
      when: run.startedAt,
      score: Math.round(score * 100) / 100,
      excerpt: excerptFor(run, queryTerms),
    }))
}

/** Pull the passage of a past summary that actually overlaps the new goal. */
function excerptFor(run: RunRecord, queryTerms: Set<string>): string {
  const paragraphs = run.summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40)
  if (paragraphs.length === 0) return run.summary.slice(0, 400).trim()

  let best = paragraphs[0]
  let bestHits = -1
  for (const para of paragraphs) {
    const hits = tokenize(para).filter((t) => queryTerms.has(t)).length
    if (hits > bestHits) {
      bestHits = hits
      best = para
    }
  }
  return best.length > 500 ? `${best.slice(0, 500)}…` : best
}

/** Render recollections as a prompt block, or '' when there is nothing to recall. */
export function recallBlock(memories: Recollection[]): string {
  if (!memories.length) return ''
  const body = memories
    .map((m) => {
      const days = Math.round((Date.now() - m.when) / 86_400_000)
      const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
      return `- From "${m.title}" (${when}):\n  ${m.excerpt.replace(/\n/g, '\n  ')}`
    })
    .join('\n\n')
  return `\n\nRelevant work you did for this same user previously — build on it, stay consistent with it, and do NOT repeat research it already contains:\n${body}`
}

/** Keyword search over a user's run history, for the history panel. */
export function searchRuns(user: string, query: string, limit = 20) {
  const terms = tokenize(query)
  const runs = runsForUser(user)
  if (!terms.length) return runs.slice(0, limit)
  return runs
    .map((run) => {
      const haystack = `${run.title} ${run.goal} ${run.summary}`.toLowerCase()
      const hits = terms.filter((t) => haystack.includes(t)).length
      return { run, hits }
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.run.startedAt - a.run.startedAt)
    .slice(0, limit)
    .map((s) => s.run)
}

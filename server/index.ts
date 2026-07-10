import 'dotenv/config'
import express from 'express'
import path from 'path'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import { planTasks } from './agent/planner.js'
import { executeTask, synthesize } from './agent/executor.js'
import { reviewResult } from './agent/critic.js'
import { getClarifyingQuestions } from './agent/clarify.js'
import { verifyLLMKey } from './agent/llm.js'
import { generateResultPdf } from './agent/pdf.js'
import { sendPdfEmail } from './agent/tools.js'
import { signup, login } from './auth.js'
import type { WSMessage, Task } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Download files the writer agent saved to agent_workspace, so the chat can
// offer them as download chips. Same path confinement as the write_file tool.
app.get('/files/*', (req, res) => {
  const rel = decodeURIComponent((req.params as Record<string, string>)[0] ?? '')
  const base = path.resolve('./agent_workspace')
  const safe = path.resolve(base, rel.replace(/^[/\\]+/, ''))
  if (safe === base || !safe.startsWith(base + path.sep)) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }
  res.download(safe, path.basename(safe), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
  })
})

// ── Auth routes ─────────────────────────────────────────────────────────────
// In-memory rate limit: 10 auth attempts per IP per 5 minutes. Enough for a
// human who typoed a password; a wall for credential-stuffing scripts.
const authHits = new Map<string, number[]>()
function authLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < 5 * 60_000)
  if (hits.length >= 10) {
    res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' })
    return
  }
  hits.push(now)
  authHits.set(ip, hits)
  next()
}

app.post('/auth/signup', authLimiter, (req, res) => {
  try {
    const { name, email, password } = req.body ?? {}
    res.json(signup(name, email, password))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/auth/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    res.json(login(email, password))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

type Delivery = 'screen' | 'email'

interface Incoming {
  type?: 'start' | 'clarify' | 'approve' | 'cancel' | 'followup'
  goal?: string
  delivery?: string
  email?: string
  answers?: { question: string; answer: string }[]
  // Chat-style clients auto-approve everything — let them skip the
  // clarifying-questions LLM call entirely instead of discarding it.
  skipClarify?: boolean
}

wss.on('connection', (ws: WebSocket, req) => {
  // Browsers send an Origin header — reject cross-site pages so a random
  // website can't drive the agent. Non-browser clients (no Origin) pass,
  // which keeps local tooling working.
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    ws.close(1008, 'Origin not allowed')
    return
  }
  console.log('Client connected')

  const send = (msg: WSMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  // ── Per-connection conversation state ──────────────────────────────────────
  let pending: { goal: string; title: string; delivery: Delivery; email: string } | null = null
  let proposedTasks: Task[] = []
  let lastSummary = '' // carried into follow-ups as context
  let lastDelivery: Delivery = 'screen'
  let lastEmail = ''
  let busy = false // ignore overlapping commands while one is in flight

  // Run the approved/clarified plan and deliver the result.
  async function runAndDeliver(goal: string, title: string, delivery: Delivery, email: string, tasks: Task[]) {
    send({ type: 'plan', payload: tasks })

    const completed: { description: string; result: string }[] = []
    for (const task of tasks) {
      send({ type: 'task_start', payload: task })
      try {
        const result = await executeTask(task, send, { goal, previous: completed })
        task.status = 'done'
        task.result = result
        completed.push({ description: task.description, result })
      } catch {
        task.status = 'done'
        task.result = 'Step skipped — the AI service was busy.'
        completed.push({ description: task.description, result: task.result })
      }
      send({ type: 'task_done', payload: task })
    }

    send({ type: 'log', payload: 'Synthesizing final answer…' })
    let summary = await synthesize(goal, tasks)

    // Critic reviews the team's answer; one bounded revision if it's weak.
    send({ type: 'log', payload: '🧐 Critic reviewing the result…' })
    const review = await reviewResult(title, summary)
    if (!review.ok && review.feedback) {
      send({ type: 'log', payload: `Critic requested a revision: ${review.feedback}` })
      summary = await synthesize(goal, tasks, review.feedback)
    }
    lastSummary = summary

    if (delivery === 'email') {
      send({ type: 'log', payload: `Generating PDF and emailing to ${email}…` })
      const pdf = await generateResultPdf(title, summary)
      const intro = `Hi,\n\nYour Equilibrium AI Agent report for "${title}" is attached as a PDF.\n\n— Equilibrium`
      const mail = await sendPdfEmail(email, `Your Equilibrium report: ${title}`, intro, pdf)
      send({
        type: 'agent_done',
        payload: { goal: title, tasks, summary, delivery, email, emailOk: mail.success, emailInfo: mail.output },
      })
    } else {
      send({ type: 'agent_done', payload: { goal: title, tasks, summary, delivery } })
    }
  }

  async function proposePlan() {
    if (!pending) return
    send({ type: 'log', payload: 'Drafting a plan…' })
    proposedTasks = await planTasks(pending.goal)
    send({ type: 'plan_proposed', payload: { tasks: proposedTasks } })
  }

  ws.on('message', async (raw) => {
    let data: Incoming
    try {
      data = JSON.parse(raw.toString()) as Incoming
    } catch {
      send({ type: 'agent_error', payload: 'Invalid message format' })
      return
    }

    if (busy) return // a command is already running; ignore extras
    busy = true
    try {
      switch (data.type) {
        case 'start': {
          const goal = (data.goal ?? '').trim()
          if (!goal) {
            send({ type: 'agent_error', payload: 'No goal provided' })
            break
          }
          const delivery: Delivery = data.delivery === 'email' ? 'email' : 'screen'
          const email = (data.email ?? '').trim()
          if (delivery === 'email' && !email) {
            send({ type: 'agent_error', payload: 'No email provided for email delivery' })
            break
          }
          pending = { goal, title: goal, delivery, email }
          lastDelivery = delivery
          lastEmail = email

          if (data.skipClarify) {
            await proposePlan()
            break
          }
          send({ type: 'log', payload: 'Reviewing your request…' })
          const questions = await getClarifyingQuestions(goal)
          if (questions.length) {
            send({ type: 'clarify', payload: { questions } })
          } else {
            await proposePlan()
          }
          break
        }

        case 'clarify': {
          if (!pending) break
          const detail = (data.answers ?? [])
            .filter((a) => a && String(a.answer ?? '').trim())
            .map((a) => `- ${a.question} → ${a.answer}`)
            .join('\n')
          if (detail) pending.goal = `${pending.title}\n\nAdditional details from the user:\n${detail}`
          await proposePlan()
          break
        }

        case 'approve': {
          if (!pending) break
          const { goal, title, delivery, email } = pending
          const tasks = proposedTasks.length ? proposedTasks : await planTasks(goal)
          pending = null
          proposedTasks = []
          await runAndDeliver(goal, title, delivery, email, tasks)
          break
        }

        case 'cancel': {
          pending = null
          proposedTasks = []
          send({ type: 'cancelled', payload: null })
          break
        }

        case 'followup': {
          const fg = (data.goal ?? '').trim()
          if (!fg) break
          const goal = lastSummary
            ? `Earlier you produced this result:\n${lastSummary.slice(0, 800)}\n\nThe user now asks: ${fg}\nUse the earlier result as context.`
            : fg
          send({ type: 'log', payload: 'Working on your follow-up…' })
          const tasks = await planTasks(goal)
          await runAndDeliver(goal, fg, lastDelivery, lastEmail, tasks)
          break
        }

        default:
          send({ type: 'agent_error', payload: 'Unknown request' })
      }
    } catch {
      send({ type: 'agent_error', payload: 'The AI service is busy right now. Please try again in a minute.' })
    } finally {
      busy = false
    }
  })

  ws.on('close', () => console.log('Client disconnected'))
})

const PORT = process.env.PORT ?? 4000
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Agent server running on http://localhost:${PORT}`)
  console.log(`   WebSocket ready on ws://localhost:${PORT}\n`)
  void verifyLLMKey()
})

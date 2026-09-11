import { runSwarm } from './swarm.js'
import { synthesize } from './executor.js'
import { reviewResult } from './critic.js'
import { generateResultPdf } from './pdf.js'
import { sendPdfEmail } from './tools.js'
import { UsageMeter, runWithMeter } from './usage.js'
import { isCancelled } from './cancellation.js'
import { saveRun, newRunId } from './store.js'
import type { DeliveryMode, RunRecord, Task, WSMessage } from '../types.js'

// ── One run, start to finish ──────────────────────────────────────────────────
// Shared by the interactive websocket session and the scheduler, so a plan that
// runs at 8am on a Sunday goes through exactly the same swarm, critic and
// delivery as one typed into the chat. The caller supplies `send`; the
// scheduler passes a sink that only collects the log.

export interface RunOptions {
  goal: string
  title: string
  tasks: Task[]
  /** Owning account email, or null for a signed-out session (nothing persists). */
  user: string | null
  delivery: DeliveryMode
  email: string
  /** Past runs pulled in as context, already formatted. */
  memoryBlock?: string
  send: (msg: WSMessage) => void
  signal?: AbortSignal
}

export interface RunOutcome {
  runId: string
  summary: string
  status: RunRecord['status']
  files: string[]
  emailOk?: boolean
  emailInfo?: string
}

export async function executeRun(opts: RunOptions): Promise<RunOutcome> {
  const { goal, title, tasks, user, delivery, email, memoryBlock, send } = opts
  const runId = newRunId()
  const meter = new UsageMeter()
  const startedAt = Date.now()
  const files: string[] = []

  // Watch the event stream for artifacts the specialists saved, so the run
  // record and the client both know what the run actually produced.
  const track = (msg: WSMessage) => {
    if (msg.type === 'tool_result') {
      const p = msg.payload as { result?: string } | null
      const written = p?.result?.match(/agent_workspace\/([^\s)]+)/)
      if (written?.[1] && !files.includes(written[1])) files.push(written[1])
    }
    send(msg)
  }

  // Stream token/latency telemetry while the run is in flight.
  const ticker = setInterval(() => send({ type: 'usage', payload: meter.snapshot() }), 1500)

  const persist = async (status: RunRecord['status'], summary: string, error?: string) => {
    send({ type: 'usage', payload: meter.snapshot() })
    if (!user) return
    const record: RunRecord = {
      id: runId,
      user,
      title,
      goal,
      summary,
      tasks,
      files,
      usage: meter.snapshot(),
      delivery,
      startedAt,
      finishedAt: Date.now(),
      status,
      ...(error ? { error } : {}),
    }
    await saveRun(record)
    send({ type: 'run_saved', payload: { id: runId, title, status, files } })
  }

  try {
    return await runWithMeter(meter, async () => {
      send({ type: 'plan', payload: tasks })

      await runSwarm({ goal, tasks, send: track, signal: opts.signal, memoryBlock })

      // Stream the answer as it is written. The client renders these deltas
      // into a live bubble; `answer_start` tells it to clear whatever the
      // previous draft left there, which matters for the critic's revision.
      const streamAnswer = (label: string) => {
        send({ type: 'answer_start', payload: label })
        return (text: string) => send({ type: 'answer_delta', payload: text })
      }

      send({ type: 'log', payload: 'Synthesizing final answer…' })
      let summary = await synthesize(goal, tasks, undefined, memoryBlock, streamAnswer('draft'))

      // Critic reviews the team's answer; one bounded revision if it's weak.
      send({ type: 'log', payload: '🧐 Critic reviewing the result…' })
      const review = await reviewResult(title, summary)
      if (!review.ok && review.feedback) {
        send({ type: 'log', payload: `Critic requested a revision: ${review.feedback}` })
        summary = await synthesize(goal, tasks, review.feedback, memoryBlock, streamAnswer('revision'))
      }

      await persist('done', summary)

      if (delivery === 'email') {
        send({ type: 'log', payload: `Generating PDF and emailing to ${email}…` })
        const pdf = await generateResultPdf(title, summary)
        const intro = `Hi,\n\nYour Equilibrium AI Agent report for "${title}" is attached as a PDF.\n\n— Equilibrium`
        const mail = await sendPdfEmail(email, `Your Equilibrium report: ${title}`, intro, pdf)
        send({
          type: 'agent_done',
          payload: {
            runId,
            goal: title,
            tasks,
            summary,
            files,
            usage: meter.snapshot(),
            delivery,
            email,
            emailOk: mail.success,
            emailInfo: mail.output,
          },
        })
        return { runId, summary, status: 'done' as const, files, emailOk: mail.success, emailInfo: mail.output }
      }

      send({
        type: 'agent_done',
        payload: { runId, goal: title, tasks, summary, files, usage: meter.snapshot(), delivery },
      })
      return { runId, summary, status: 'done' as const, files }
    })
  } catch (err) {
    if (isCancelled(err)) {
      // No summary: a cancelled run produced no answer, and carrying the
      // previous turn's summary in would misattribute it to this one.
      await persist('cancelled', '', 'Cancelled by the user')
      send({ type: 'cancelled', payload: { runId } })
      return { runId, summary: '', status: 'cancelled', files }
    }
    throw err
  } finally {
    clearInterval(ticker)
  }
}

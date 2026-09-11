import { useState, useRef, useCallback } from 'react'
import { WS_URL } from '@/api'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'

export type AgentRole = 'researcher' | 'writer' | 'analyst' | 'generalist'

export interface AgentTask {
  id: string
  description: string
  status: TaskStatus
  result?: string
  role?: AgentRole
  /** Ids this task waits on — the plan is a graph, not a list. */
  dependsOn?: string[]
  durationMs?: number
}

/** Live token/latency accounting for the run in flight. */
export interface AgentUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
  byModel: Record<string, number>
  elapsedMs: number
}

/** A past run the swarm recalled as relevant to the current goal. */
export interface RecalledRun {
  runId: string
  title: string
  when: number
}

export interface AgentEvent {
  type: string
  payload: unknown
  timestamp: number
}

export type DeliveryMode = 'screen' | 'email'

export interface RunOptions {
  delivery: DeliveryMode
  email?: string
  token?: string
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'clarifying'
  | 'awaiting_approval'
  | 'running'
  | 'finishing'
  | 'done'
  | 'error'

export interface ConversationTurn {
  goal: string
  summary: string
}

export interface AgentState {
  status: AgentStatus
  goal: string
  tasks: AgentTask[]
  events: AgentEvent[]
  summary: string
  error: string
  delivery: DeliveryMode
  emailOk?: boolean
  emailedTo?: string
  emailInfo?: string
  clarifyQuestions: string[]
  history: ConversationTurn[]
  /** Token spend so far, updated live while the swarm works. */
  usage: AgentUsage
  /** Past runs the swarm pulled in as context for this goal. */
  recalled: RecalledRun[]
  /** Workspace files this run produced. */
  files: string[]
  /** Server-side id of the saved run, once it has been persisted. */
  runId: string
  /** The answer as it streams in, before `agent_done` delivers the final text. */
  streamingAnswer: string
}

const emptyUsage: AgentUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
  byModel: {},
  elapsedMs: 0,
}


const initialState: AgentState = {
  status: 'idle',
  goal: '',
  tasks: [],
  events: [],
  summary: '',
  error: '',
  delivery: 'screen',
  clarifyQuestions: [],
  history: [],
  usage: emptyUsage,
  recalled: [],
  files: [],
  runId: '',
  streamingAnswer: '',
}

export function useAgent() {
  const wsRef = useRef<WebSocket | null>(null)
  const finishTimerRef = useRef<number | null>(null)
  const [state, setState] = useState<AgentState>(initialState)

  const addEvent = (type: string, payload: unknown) =>
    setState((prev) => ({ ...prev, events: [...prev.events, { type, payload, timestamp: Date.now() }] }))

  const handleMessage = useCallback((event: MessageEvent) => {
    const msg = JSON.parse(event.data as string) as { type: string; payload: unknown }
    addEvent(msg.type, msg.payload)

    // Hold on a "finishing" state so the loader fills to 100% and is actually
    // seen, then reveal the result a beat later.
    if (msg.type === 'agent_done') {
      const p = msg.payload as {
        summary: string
        tasks: AgentTask[]
        delivery?: DeliveryMode
        email?: string
        emailOk?: boolean
        emailInfo?: string
        usage?: AgentUsage
        files?: string[]
        runId?: string
      }
      setState((prev) => ({
        ...prev,
        status: 'finishing',
        streamingAnswer: '',
        summary: p.summary,
        tasks: p.tasks,
        delivery: p.delivery ?? prev.delivery,
        emailOk: p.emailOk,
        emailedTo: p.email,
        emailInfo: p.emailInfo,
        usage: p.usage ?? prev.usage,
        files: p.files ?? prev.files,
        runId: p.runId ?? prev.runId,
      }))
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current)
      finishTimerRef.current = window.setTimeout(() => {
        setState((prev) => (prev.status === 'finishing' ? { ...prev, status: 'done' } : prev))
      }, 1100)
      return
    }

    setState((prev) => {
      switch (msg.type) {
        // A fresh draft is starting (the critic's revision reuses this), so
        // throw away whatever the previous one had written.
        case 'answer_start':
          return { ...prev, streamingAnswer: '' }

        case 'answer_delta':
          return { ...prev, streamingAnswer: prev.streamingAnswer + (msg.payload as string) }

        case 'clarify':
          return {
            ...prev,
            status: 'clarifying',
            clarifyQuestions: (msg.payload as { questions: string[] }).questions,
          }

        case 'plan_proposed':
          return {
            ...prev,
            status: 'awaiting_approval',
            clarifyQuestions: [],
            tasks: (msg.payload as { tasks: AgentTask[] }).tasks,
          }

        case 'plan':
          return { ...prev, status: 'running', clarifyQuestions: [], tasks: msg.payload as AgentTask[] }

        case 'task_start':
          return {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === (msg.payload as AgentTask).id ? { ...t, status: 'running' } : t
            ),
          }

        case 'task_done':
        case 'task_failed': {
          const updated = msg.payload as AgentTask
          return { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) }
        }

        case 'usage':
          return { ...prev, usage: msg.payload as AgentUsage }

        case 'memory':
          return { ...prev, recalled: msg.payload as RecalledRun[] }

        case 'tool_result': {
          // Track artifacts as they are produced so the run's files are
          // available even if it is cancelled before the final answer.
          const p = msg.payload as { result?: string } | null
          const written = p?.result?.match(/agent_workspace\/([^\s)]+)/)
          if (!written?.[1] || prev.files.includes(written[1])) return prev
          return { ...prev, files: [...prev.files, written[1]] }
        }

        case 'run_saved':
          return { ...prev, runId: (msg.payload as { id: string }).id }

        case 'cancelled':
          return { ...initialState, history: prev.history }

        case 'agent_error':
          return { ...prev, status: 'error', error: msg.payload as string }

        default:
          return prev
      }
    })
  }, [])

  const sendRaw = (obj: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  // Begin a new conversation with a goal.
  const start = useCallback(
    (goal: string, opts: RunOptions) => {
      if (wsRef.current) wsRef.current.close()

      setState({
        ...initialState,
        status: 'thinking',
        goal,
        delivery: opts.delivery,
      })

      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen = () =>
        ws.send(
          JSON.stringify({ type: 'start', goal, delivery: opts.delivery, email: opts.email, token: opts.token })
        )
      ws.onmessage = handleMessage
      ws.onerror = () =>
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Could not connect to the agent server. Is it running on port 4000?',
        }))
    },
    [handleMessage]
  )

  const submitClarifications = useCallback((answers: { question: string; answer: string }[]) => {
    setState((prev) => ({ ...prev, status: 'thinking', clarifyQuestions: [] }))
    sendRaw({ type: 'clarify', answers })
  }, [])

  const approvePlan = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: 'running',
      tasks: prev.tasks.map((t) => ({ ...t, status: 'pending' })),
    }))
    sendRaw({ type: 'approve' })
  }, [])

  // Stop the run. The server aborts between steps and replies with
  // `cancelled`, so the local reset happens there — leaving the UI showing
  // "stopping…" until the swarm has actually stood down.
  const cancel = useCallback(() => {
    sendRaw({ type: 'cancel' })
  }, [])

  // Continue the conversation after a result.
  const sendFollowup = useCallback((text: string) => {
    setState((prev) => ({
      ...prev,
      status: 'thinking',
      goal: text,
      tasks: [],
      events: [],
      summary: '',
      clarifyQuestions: [],
      // archive the just-finished turn so the thread is visible
      history: prev.summary
        ? [...prev.history, { goal: prev.goal, summary: prev.summary }]
        : prev.history,
    }))
    sendRaw({ type: 'followup', goal: text })
  }, [])

  const reset = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setState(initialState)
  }, [])

  return { state, start, submitClarifications, approvePlan, cancel, sendFollowup, reset }
}

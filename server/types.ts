// Which specialist agent handles a task (the swarm divides work by role).
export type AgentRole = 'researcher' | 'writer' | 'analyst' | 'generalist'

export interface Task {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
  role?: AgentRole
  /**
   * Ids of tasks that must finish before this one starts. Tasks with no
   * unmet dependency run concurrently, so the plan is a DAG rather than a
   * strict sequence. Empty/absent means "can start immediately".
   */
  dependsOn?: string[]
  /** Wall-clock milliseconds the task took (set by the executor). */
  durationMs?: number
}

export interface AgentPlan {
  goal: string
  tasks: Task[]
}

export type DeliveryMode = 'screen' | 'email'

export interface AgentRequest {
  goal: string
  delivery?: DeliveryMode
  email?: string
  token?: string
}

export type ToolName =
  | 'web_search'
  | 'write_file'
  | 'call_api'
  | 'send_email'
  | 'run_code'
  | 'read_url'
  | 'read_file'
  | 'list_files'
  | 'make_chart'

export interface ToolCall {
  name: ToolName
  args: Record<string, unknown>
}

export type WSMessageType =
  | 'clarify'
  | 'plan_proposed'
  | 'plan'
  | 'task_start'
  | 'task_done'
  | 'task_failed'
  | 'tool_call'
  | 'tool_result'
  | 'agent_done'
  | 'agent_error'
  | 'cancelled'
  | 'log'
  // The final answer, streamed: 'answer_start' opens a fresh bubble (and is
  // sent again for the critic's revision), 'answer_delta' carries each token.
  | 'answer_start'
  | 'answer_delta'
  | 'usage'
  | 'memory'
  | 'run_saved'

export interface WSMessage {
  type: WSMessageType
  payload: unknown
}

// ── Telemetry ────────────────────────────────────────────────────────────────
/** Token/latency accounting for one run, streamed to the client as it grows. */
export interface UsageSnapshot {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
  /** Calls per model id, so a fallback to a weaker model is visible. */
  byModel: Record<string, number>
  elapsedMs: number
}

// ── Run history ──────────────────────────────────────────────────────────────
/** A completed (or failed) run, persisted so it can be listed and reopened. */
export interface RunRecord {
  id: string
  /** Owning user's email, or 'anonymous' for signed-out sessions. */
  user: string
  title: string
  goal: string
  summary: string
  tasks: Task[]
  /** Workspace-relative paths of files the run produced. */
  files: string[]
  usage: UsageSnapshot
  delivery: DeliveryMode
  startedAt: number
  finishedAt: number
  status: 'done' | 'error' | 'cancelled'
  error?: string
}

/** The trimmed shape returned by the run-list endpoint. */
export interface RunSummary {
  id: string
  title: string
  startedAt: number
  finishedAt: number
  status: RunRecord['status']
  taskCount: number
  totalTokens: number
  files: string[]
}

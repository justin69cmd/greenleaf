// Which specialist agent handles a task (the swarm divides work by role).
export type AgentRole = 'researcher' | 'writer' | 'analyst' | 'generalist'

export interface Task {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
  role?: AgentRole
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

export interface WSMessage {
  type: WSMessageType
  payload: unknown
}

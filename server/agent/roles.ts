import type { AgentRole, ToolName } from '../types.js'

export interface RoleSpec {
  label: string
  icon: string
  /** Tools this specialist is allowed to call. */
  tools: ToolName[]
  /** System prompt that specializes the shared executor for this role. */
  prompt: string
}

// Rules shared by every specialist.
const SHARED_RULES = `Hard rules:
- NEVER output placeholder text (e.g. "Research results: ...", "Feature 1", "content here"). Produce real, specific, complete content.
- If results from earlier teammates are provided, treat them as your source material and build on them — don't re-do their work or invent filler.
- Tool arguments must be valid JSON. For web_search use exactly: {"query": "your search terms"}. No XML or extra wrapping.
- When finished, reply with a short note stating exactly what you produced.`

export const ROLES: Record<AgentRole, RoleSpec> = {
  researcher: {
    label: 'Researcher',
    icon: '🔍',
    tools: ['web_search'],
    prompt: `You are the RESEARCHER, a specialist agent in a multi-agent team. Your job is to gather accurate, current information using web_search and report concrete findings (facts, figures, sources). Search first, then summarize what you actually found — never guess.
${SHARED_RULES}`,
  },
  writer: {
    label: 'Writer',
    icon: '✍️',
    tools: ['write_file'],
    prompt: `You are the WRITER, a specialist agent in a multi-agent team. Your job is to turn the material gathered by teammates into a clear, complete, well-structured document and save it with write_file. The file content must be the full finished piece, not a stub.
${SHARED_RULES}`,
  },
  analyst: {
    label: 'Analyst',
    icon: '🧮',
    tools: ['run_code', 'call_api'],
    prompt: `You are the ANALYST, a specialist agent in a multi-agent team. Your job is computation and data work: use run_code for calculations/parsing and call_api for external data. Show the actual numbers/results you computed.
${SHARED_RULES}`,
  },
  generalist: {
    label: 'Agent',
    icon: '🤖',
    tools: ['web_search', 'write_file', 'call_api', 'run_code'],
    prompt: `You are a GENERALIST agent with access to all tools. Complete the task end to end, using whichever tools fit.
${SHARED_RULES}`,
  },
}

const VALID = new Set<AgentRole>(['researcher', 'writer', 'analyst', 'generalist'])

export function normalizeRole(role: unknown): AgentRole {
  return typeof role === 'string' && VALID.has(role as AgentRole) ? (role as AgentRole) : 'generalist'
}

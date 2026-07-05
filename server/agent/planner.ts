import { chatWithFallback } from './llm.js'
import { normalizeRole } from './roles.js'
import type { Task } from '../types.js'

const PLANNER_PROMPT = `You are the ORCHESTRATOR of a multi-agent AI team. Divide the user's goal into the
SMALLEST set of concrete, ordered subtasks (usually 2-3) and assign EACH subtask to the right specialist.

The team shares memory: every subtask automatically receives the results of all earlier subtasks, so a
"gather" subtask can feed a "use it" subtask.

Specialists (set "role" to one of these) and the tools they can use:
- "researcher" — gathers information from the web (web_search)
- "writer" — produces and saves documents (write_file)
- "analyst" — computation and data work (run_code, call_api)
- "generalist" — mixed tasks needing several tools

Guidelines:
- Assign the role whose tools match the subtask. Research before writing; analyze before reporting.
- Keep it SHORT (2-3 subtasks). Avoid redundant or vague subtasks.
- Do NOT create subtasks that email or notify the user — delivery is handled separately.
- Make descriptions specific (what to search, what file to write, what it should contain).

Respond ONLY with a valid JSON array, no explanation, no markdown. Example:
[
  { "id": "1", "description": "Search the web for the top 5 AI agent frameworks of 2024 and their key features", "role": "researcher", "status": "pending" },
  { "id": "2", "description": "Write a structured summary of those frameworks to ai_frameworks.txt using the research", "role": "writer", "status": "pending" }
]`

export async function planTasks(goal: string): Promise<Task[]> {
  // Single-task fallback — used if the planner is rate-limited or returns junk,
  // so a planning hiccup never errors out the whole run.
  const fallbackPlan: Task[] = [{ id: '1', description: goal, status: 'pending', role: 'generalist' }]

  let text = ''
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: `User goal: ${goal}` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    })
    text = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch {
    return fallbackPlan
  }

  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  // Models sometimes wrap the JSON in prose — salvage the outermost array.
  const arrayMatch = clean.startsWith('[') ? null : clean.match(/\[[\s\S]*\]/)

  try {
    const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : clean)
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Planner did not return tasks')
    return parsed.map((t, i) => ({
      id: t?.id ?? String(i + 1),
      description: String(t?.description ?? goal),
      status: t?.status ?? 'pending',
      role: normalizeRole(t?.role),
    }))
  } catch {
    console.warn('[planner] unparseable plan, using single-task fallback. Output began:', text.slice(0, 160))
    return fallbackPlan
  }
}

import { chatWithFallback } from './llm.js'
import { normalizeRole } from './roles.js'
import type { Task } from '../types.js'

const PLANNER_PROMPT = `You are the ORCHESTRATOR of a multi-agent AI team. Divide the user's goal into the
SMALLEST set of concrete, ordered subtasks (usually 2-3) and assign EACH subtask to the right specialist.

The team shares memory: every subtask automatically receives the results of the subtasks it depends on, so a
"gather" subtask can feed a "use it" subtask.

The plan is a GRAPH, not a list. Give every subtask a "dependsOn" array naming the ids whose results it needs.
Subtasks with no shared dependency RUN AT THE SAME TIME, so splitting independent research into two subtasks
costs nothing in wall-clock time. Use "dependsOn": [] for anything that can start immediately.

Specialists (set "role" to one of these) and the tools they can use:
- "researcher" — gathers information from the web (web_search, read_url)
- "writer" — produces and saves documents (write_file, read_file, list_files)
- "analyst" — computation, data work, and charts (run_code, call_api, read_file, make_chart)
- "generalist" — mixed tasks needing several tools

Guidelines:
- Assign the role whose tools match the subtask. Research before writing; analyze before reporting.
- Keep it SHORT (2-4 subtasks). Avoid redundant or vague subtasks.
- Prefer a wide plan over a deep one: independent subtasks running in parallel finish sooner than a chain.
- Do NOT create subtasks that email or notify the user — delivery is handled separately.
- Make descriptions specific (what to search, what file to write, what it should contain).
- For a chart or visual comparison, say "chart it with make_chart" — the analyst renders the chart itself.
  Never ask for a .png, or for an image to be found or downloaded.

Respond ONLY with a valid JSON array, no explanation, no markdown. Example:
[
  { "id": "1", "description": "Search the web for the top 5 AI agent frameworks of 2024 and their key features", "role": "researcher", "status": "pending", "dependsOn": [] },
  { "id": "2", "description": "Search the web for 2024 adoption numbers and GitHub stars for those frameworks", "role": "researcher", "status": "pending", "dependsOn": [] },
  { "id": "3", "description": "Write a structured comparison of the frameworks to ai_frameworks.md using the research", "role": "writer", "status": "pending", "dependsOn": ["1", "2"] }
]`

export async function planTasks(goal: string, memoryBlock?: string): Promise<Task[]> {
  // Single-task fallback — used if the planner is rate-limited or returns junk,
  // so a planning hiccup never errors out the whole run.
  const fallbackPlan: Task[] = [
    { id: '1', description: goal, status: 'pending', role: 'generalist', dependsOn: [] },
  ]

  let text = ''
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: `User goal: ${goal}${memoryBlock ?? ''}` },
      ],
      temperature: 0.3,
      // Plans now carry a dependency graph, so give the planner room to
      // finish the array rather than getting clipped mid-object.
      max_tokens: 1600,
    })
    text = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch {
    return fallbackPlan
  }

  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  // Models sometimes wrap the JSON in prose — salvage the outermost array.
  const arrayMatch = clean.startsWith('[') ? null : clean.match(/\[[\s\S]*\]/)

  try {
    let parsed: unknown
    try {
      parsed = JSON.parse(arrayMatch ? arrayMatch[0] : clean)
    } catch {
      // A plan cut off by the token budget is still mostly usable: keep the
      // task objects that did come through instead of discarding the plan and
      // collapsing the whole run into one generalist task.
      parsed = salvageObjects(clean)
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Planner did not return tasks')
    return parsed.map((t, i) => ({
      id: String(t?.id ?? i + 1),
      description: String(t?.description ?? goal),
      status: t?.status ?? 'pending',
      role: normalizeRole(t?.role),
      // The scheduler validates these against real ids and breaks cycles, so
      // an imaginative planner can't deadlock a run.
      dependsOn: Array.isArray(t?.dependsOn) ? t.dependsOn.map((d: unknown) => String(d)) : [],
    }))
  } catch {
    console.warn('[planner] unparseable plan, using single-task fallback. Output began:', text.slice(0, 160))
    return fallbackPlan
  }
}

/**
 * Pull every complete `{...}` object out of a possibly truncated JSON array.
 * Brace counting has to ignore braces inside strings, so this walks the text
 * rather than using a regex.
 */
function salvageObjects(text: string): unknown[] {
  const objects: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          /* skip a fragment that still doesn't parse */
        }
        start = -1
      }
    }
  }
  return objects
}

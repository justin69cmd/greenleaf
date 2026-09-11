import type { Task, WSMessage, ToolName } from '../types.js'
import {
  webSearch,
  writeFile,
  callApi,
  runCode,
  readUrl,
  readWorkspaceFile,
  listFiles,
  makeChart,
} from './tools.js'
import {
  chatWithFallback,
  isRequestTooLarge,
  isRateLimit,
  type ChatTool,
  type ChatMessage,
  type ChatCompletion,
} from './llm.js'
import { ROLES, normalizeRole } from './roles.js'
import { throwIfCancelled } from './cancellation.js'

type Sender = (msg: WSMessage) => void

const SYNTH_PROMPT = `You are writing the final answer for an autonomous agent run.
Using the completed task results below, write a clear, complete answer that directly fulfills the user's goal.
Include the ACTUAL findings and content produced — not a description of what was done.
If files were written, mention them and include their key content. Be substantive but concise. No placeholders.

Format the answer as clean Markdown so it renders beautifully:
- Start with a short "# " title summarizing the result.
- Use "## " subheadings to group sections when helpful.
- Use "- " for bullet points and "1." for ordered lists.
- Use **bold** for key terms.
- Keep paragraphs short. Do not include code fences or HTML.`

const tools: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_api',
      description: 'Make an HTTP request. Supports headers and a JSON body for POST/PUT/PATCH.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          headers: { type: 'object', description: 'Optional HTTP headers as key/value pairs' },
          body: { type: 'object', description: 'Optional JSON request body' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: 'Run JavaScript code and return output',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description:
        'Fetch a web page and return its readable text. Use this to read a source found with web_search instead of relying on the snippet.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) URL of the page to read' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file a teammate saved earlier in the shared workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path, e.g. research_notes.md' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List the files available in the shared workspace.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional workspace-relative subdirectory' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_chart',
      description:
        'Render numeric data as an SVG chart saved to the workspace. Use for comparisons, trends, and breakdowns.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['bar', 'line', 'pie'] },
          title: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' }, description: 'One label per data point' },
          values: { type: 'array', items: { type: 'number' }, description: 'One number per label' },
          path: { type: 'string', description: 'Optional output filename, e.g. revenue.svg' },
        },
        required: ['type', 'title', 'labels', 'values'],
      },
    },
  },
]

// Only treat plain objects as valid args. Arrays / strings / numbers are NOT
// valid tool arguments and must not be returned (they make args.query etc.
// silently undefined).
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  const direct = asRecord(raw)
  if (direct) return direct
  if (typeof raw !== 'string') return {}
  let s = raw.trim()

  // Try direct parse, unwrapping up to one layer of double-encoded JSON
  // (Llama/Groq sometimes returns arguments as a JSON-stringified string).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = JSON.parse(s)
      const rec = asRecord(parsed)
      if (rec) return rec
      if (typeof parsed === 'string') { s = parsed.trim(); continue }
    } catch { /* not valid JSON, fall through */ }
    break
  }

  // Strip XML/function tags: <function=name>{"key":"val"}</function>
  const xmlMatch = s.match(/>(\{[\s\S]*?\})</)
  if (xmlMatch) {
    try { const r = asRecord(JSON.parse(xmlMatch[1])); if (r) return r } catch { /* continue */ }
  }
  // Find first {...} block (greedy so nested braces are kept)
  const braceMatch = s.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try { const r = asRecord(JSON.parse(braceMatch[0])); if (r) return r } catch { /* continue */ }
  }
  // Last resort: extract key="value" pairs
  const pairs: Record<string, string> = {}
  const kvMatches = s.matchAll(/["']?(\w+)["']?\s*[:=]\s*["']([^"']+)["']/g)
  for (const m of kvMatches) pairs[m[1]] = m[2]
  return pairs
}

const TOOL_NAMES = [
  'web_search',
  'write_file',
  'call_api',
  'send_email',
  'run_code',
  'read_url',
  'read_file',
  'list_files',
  'make_chart',
]

// Llama-on-Groq sometimes emits a tool call in its own malformed syntax, e.g.
//   <function=web_search {"query": "..."} </function>
// Groq rejects the whole request with a 400 "tool_use_failed" and returns the
// raw generation in `failed_generation`. Recover the intended call from it so a
// single bad format string doesn't kill the task.
function extractFailedToolCall(
  err: unknown
): { name: string; args: Record<string, unknown> } | null {
  const anyErr = err as { error?: { failed_generation?: string }; message?: string }
  const failed =
    anyErr?.error?.failed_generation ??
    (typeof anyErr?.message === 'string' ? anyErr.message : undefined) ??
    (typeof err === 'string' ? err : String(err))
  if (!failed) return null

  // <function=name ...args...</function>  or  <function=name>...args...</function>
  let m = failed.match(/<function=([a-zA-Z_]\w*)\s*>?([\s\S]*?)<\/function>/)
  if (m && TOOL_NAMES.includes(m[1])) return { name: m[1], args: parseArgs(m[2]) }

  // {"name":"...","arguments":{...}}
  m = failed.match(/"name"\s*:\s*"([a-zA-Z_]\w*)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*\})/)
  if (m && TOOL_NAMES.includes(m[1])) return { name: m[1], args: parseArgs(m[2]) }

  // Last resort: any known tool name + the first {...} block
  const nameM = failed.match(new RegExp(`(${TOOL_NAMES.join('|')})`))
  if (nameM) {
    const braceM = failed.match(/\{[\s\S]*\}/)
    return { name: nameM[1], args: braceM ? parseArgs(braceM[0]) : {} }
  }
  return null
}

// Coerce any LLM-supplied value to a string. Models sometimes pass objects or
// numbers where a string is expected (e.g. write_file path), which crashes the
// underlying tool with [object Object] / ERR_INVALID_ARG_TYPE.
function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

// gpt-oss emits OpenAI "harmony" channel markers, which can ride along in the
// tool name (`call_api<|channel|>commentary`). Strip them, or the call is
// dispatched as an unknown tool and the step is wasted.
export function normalizeToolName(raw: string): string {
  return String(raw ?? '')
    .split('<|')[0]
    .replace(/[^a-zA-Z0-9_]/g, '')
    .trim()
}

async function dispatchTool(rawName: string, args: Record<string, unknown>): Promise<string> {
  const name = normalizeToolName(rawName)
  switch (name) {
    case 'web_search':
      return (await webSearch(toStr(args.query))).output
    case 'write_file': {
      // The path may arrive as a nested object; dig out a usable filename.
      let rawPath: unknown = args.path
      if (rawPath && typeof rawPath === 'object') {
        const o = rawPath as Record<string, unknown>
        rawPath = o.path ?? o.file ?? o.filename ?? o.name ?? ''
      }
      let filePath = toStr(rawPath).trim()
      if (!filePath || filePath === '[object Object]') filePath = `output_${Date.now()}.txt`
      const content = toStr(args.content)
      return (await writeFile(filePath, content)).output
    }
    case 'call_api':
      return (await callApi(
        toStr(args.url),
        toStr(args.method) || 'GET',
        (asRecord(args.headers) as Record<string, string>) || {},
        args.body
      )).output
    case 'run_code':
      return (await runCode(toStr(args.code))).output
    case 'read_url':
      return (await readUrl(toStr(args.url))).output
    case 'read_file':
      return (await readWorkspaceFile(toStr(args.path ?? args.file ?? args.filename))).output
    case 'list_files':
      return (await listFiles(toStr(args.dir ?? args.path) || '.')).output
    case 'make_chart': {
      // Models occasionally send the series as a JSON string or as
      // [{label, value}] objects — normalise both into parallel arrays.
      let labels = args.labels
      let values = args.values
      const coerceArray = (v: unknown): unknown => {
        if (typeof v !== 'string') return v
        try { return JSON.parse(v) } catch { return v.split(',').map((x) => x.trim()) }
      }
      labels = coerceArray(labels)
      values = coerceArray(values)
      const data = coerceArray(args.data)
      if (Array.isArray(data) && !Array.isArray(values)) {
        labels = data.map((d) => toStr(asRecord(d)?.label ?? asRecord(d)?.name ?? ''))
        values = data.map((d) => asRecord(d)?.value ?? asRecord(d)?.y ?? 0)
      }
      return (await makeChart(
        toStr(args.type) || 'bar',
        toStr(args.title),
        labels,
        values,
        args.path ? toStr(args.path) : undefined
      )).output
    }
    default:
      return `Unknown tool: ${name}`
  }
}

export interface ExecContext {
  goal: string
  previous: { description: string; result: string }[]
  /** Aborts the task between steps when the user cancels the run. */
  signal?: AbortSignal
  /** Relevant passages recalled from this user's earlier runs. */
  memoryBlock?: string
}

// Free-tier Groq models have a ~6k tokens-per-minute cap, so we keep each
// request small: cap how much of each tool result and prior-task result we feed
// back into the conversation (~4 chars/token).
const TOOL_RESULT_CAP = 700
const PREV_RESULT_CAP = 600

export async function executeTask(task: Task, send: Sender, ctx: ExecContext): Promise<string> {
  const notifyFallback = (from: string, to: string, reason: string) =>
    send({ type: 'log', payload: `${reason} on ${from} — falling back to ${to}` })

  // Feed the results of earlier completed tasks in as source material so that
  // "use the data" tasks actually have the data the "gather" tasks produced.
  // Only the most recent few, capped, to stay under the token-per-minute limit.
  const previousBlock = ctx.previous.length
    ? '\n\nResults from earlier completed tasks (REAL data — use this as your source, do not re-invent it):\n' +
      ctx.previous
        .slice(-3)
        .map((p, i) => `[${i + 1}] ${p.description}\n${p.result.slice(0, PREV_RESULT_CAP)}`)
        .join('\n\n')
    : ''

  // Pick the specialist for this subtask: its focused prompt + only its tools.
  const role = normalizeRole(task.role)
  const spec = ROLES[role]
  const roleTools = tools.filter((t) => {
    const fn = (t as { function?: { name?: string } }).function
    return !!fn?.name && spec.tools.includes(fn.name as ToolName)
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: spec.prompt },
    {
      role: 'user',
      content: `Overall goal: ${ctx.goal}\n\nYour current task: ${task.description}${previousBlock}${ctx.memoryBlock ?? ''}`,
    },
  ]

  send({ type: 'log', payload: `${spec.icon} ${spec.label}: ${task.description}` })

  for (let i = 0; i < 6; i++) {
    throwIfCancelled(ctx.signal)
    let response: ChatCompletion
    try {
      response = (
        await chatWithFallback(
          { messages, tools: roleTools, tool_choice: 'auto', max_tokens: 1024, temperature: 0.1 },
          notifyFallback
        )
      ).completion
    } catch (err) {
      // Request too large (413) or service still rate-limited after fallback +
      // wait: stop gathering and summarize what we have, rather than failing.
      if (isRequestTooLarge(err) || isRateLimit(err)) {
        send({ type: 'log', payload: 'Service busy — summarizing what was gathered so far' })
        break
      }

      // Recover from Groq's 400 "tool_use_failed" by salvaging the malformed
      // tool call, running it, and feeding the result back as plain context.
      const recovered = extractFailedToolCall(err)
      if (!recovered) {
        // Any other unexpected error: don't crash the task — summarize so far.
        send({ type: 'log', payload: 'Recovering from an unexpected error — summarizing so far' })
        break
      }

      send({ type: 'tool_call', payload: { tool: recovered.name, args: recovered.args } })
      let result: string
      try {
        result = await dispatchTool(recovered.name, recovered.args)
      } catch (e) {
        result = `Error: ${String(e)}`
      }
      send({ type: 'tool_result', payload: { tool: recovered.name, result: result.slice(0, 800) } })

      messages.push({ role: 'assistant', content: `Called ${recovered.name}(${JSON.stringify(recovered.args)})` })
      messages.push({ role: 'user', content: `Result of ${recovered.name}:\n${result.slice(0, TOOL_RESULT_CAP)}` })
      continue
    }

    const message = response.choices[0]?.message
    if (!message) break
    // Re-send only standard fields — NVIDIA attaches extras (reasoning_content)
    // that some endpoints reject when echoed back in the conversation.
    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    })

    if (!message.tool_calls?.length) {
      return message.content?.trim() || 'Task completed.'
    }

    for (const toolCall of message.tool_calls) {
      throwIfCancelled(ctx.signal)
      if (toolCall.type !== 'function') continue // narrow the union; we only define function tools
      const name = normalizeToolName(toolCall.function.name)
      const args = parseArgs(toolCall.function.arguments)

      send({ type: 'tool_call', payload: { tool: name, args } })

      let result: string
      try {
        result = await dispatchTool(name, args)
      } catch (err) {
        result = `Error: ${String(err)}`
      }

      send({ type: 'tool_result', payload: { tool: name, result: result.slice(0, 800) } })

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.slice(0, TOOL_RESULT_CAP),
      })
    }
  }

  // Tool-call budget exhausted. Do one final pass WITHOUT tools so the model
  // can summarize using the results it just gathered, instead of discarding
  // them and returning a generic message.
  try {
    const { completion: final } = await chatWithFallback(
      {
        messages: [
          ...messages,
          { role: 'user', content: 'Summarize the result of the task based on the work above.' },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      },
      notifyFallback
    )
    const summary = final.choices[0]?.message?.content?.trim()
    if (summary) return summary
  } catch { /* fall through */ }

  return 'Task completed (reached step limit).'
}

// Produce a real, consolidated final answer from all task results instead of a
// generic "Completed X/Y tasks" line.
export async function synthesize(
  goal: string,
  tasks: Task[],
  feedback?: string,
  memoryBlock?: string,
  /** Called with each visible token, so the UI can render the answer as it lands. */
  onToken?: (text: string) => void
): Promise<string> {
  const done = tasks.filter((t) => t.status === 'done').length
  const fallback = `Completed ${done}/${tasks.length} tasks.`

  try {
    const work = tasks
      .map((t) => `Task: ${t.description}\nStatus: ${t.status}\nResult: ${(t.result ?? '(none)').slice(0, 800)}`)
      .join('\n\n')

    const revision = feedback
      ? `\n\nA reviewer flagged the previous draft. Address this feedback in your answer: ${feedback}`
      : ''

    const { completion: res } = await chatWithFallback(
      {
        messages: [
          { role: 'system', content: SYNTH_PROMPT },
          {
            role: 'user',
            content: `User goal: ${goal}\n\nCompleted work:\n${work}${memoryBlock ?? ''}${revision}\n\nWrite the final answer for the user.`,
          },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      },
      undefined,
      undefined,
      onToken
    )

    return res.choices[0]?.message?.content?.trim() || fallback
  } catch (err) {
    console.warn('[synthesize] LLM call failed:', (err as Error)?.message ?? err)
    return fallback
  }
}

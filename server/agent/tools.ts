import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { sendMail } from '../mailer.js'

const execAsync = promisify(exec)

export type ToolResult = { success: boolean; output: string }

// ── 1. Web Search ─────────────────────────────────────────────────────────────
// Order of attempts: Brave (if key) → DuckDuckGo HTML scrape (no key, real web
// results) → DuckDuckGo Instant Answer → Wikipedia. The HTML scrape is the
// workhorse that actually returns useful results without any API key.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').trim()
}

// Scrape DuckDuckGo's no-JS HTML endpoint. Returns formatted results or null.
async function duckDuckGoHtml(query: string): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const html = await res.text()

  const titleRe = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const titles: string[] = []
  const snippets: string[] = []
  let m: RegExpExecArray | null
  while ((m = titleRe.exec(html)) && titles.length < 5) titles.push(decodeEntities(m[1]))
  while ((m = snippetRe.exec(html)) && snippets.length < 5) snippets.push(decodeEntities(m[1]))

  if (titles.length === 0) return null
  const out = titles
    .map((t, i) => `• ${t}${snippets[i] ? `\n  ${snippets[i]}` : ''}`)
    .filter((line) => line.replace(/^•\s*/, '').trim().length > 0)
    .join('\n\n')
  return out || null
}

export async function webSearch(query: string): Promise<ToolResult> {
  try {
    if (!query?.trim()) return { success: false, output: 'No query provided' }

    // 1) Brave Search API (only if a key is configured)
    const braveKey = process.env.BRAVE_SEARCH_API_KEY
    if (braveKey) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
        })
        if (res.ok) {
          const data = (await res.json()) as {
            web?: { results?: Array<{ title: string; description: string; url: string }> }
          }
          const results = data.web?.results
            ?.map((r) => `• ${r.title}\n  ${decodeEntities(r.description)}\n  ${r.url}`)
            .join('\n\n')
          if (results) return { success: true, output: results }
        }
      } catch { /* fall through */ }
    }

    // 2) DuckDuckGo HTML scrape — real web results, no key required
    try {
      const ddg = await duckDuckGoHtml(query)
      if (ddg) return { success: true, output: ddg }
    } catch { /* fall through */ }

    // 3) DuckDuckGo Instant Answer API (sparse, but free)
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
        Results?: Array<{ Text?: string; FirstURL?: string }>
      }
      const parts: string[] = []
      if (data.AbstractText) parts.push(`${data.AbstractText}\nSource: ${data.AbstractURL}`)
      data.Results?.slice(0, 3).forEach((r) => r.Text && parts.push(`• ${r.Text}\n  ${r.FirstURL}`))
      data.RelatedTopics?.slice(0, 4).forEach((r) => r.Text && parts.push(`• ${r.Text}\n  ${r.FirstURL}`))
      if (parts.length > 0) return { success: true, output: parts.join('\n\n') }
    } catch { /* fall through */ }

    // 4) Wikipedia opensearch (last resort)
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`
      const wikiRes = await fetch(wikiUrl, { headers: { 'User-Agent': UA } })
      const wikiData = (await wikiRes.json()) as [string, string[], string[], string[]]
      const wikiResults = wikiData[1]
        ?.map((title, i) => `• ${title}\n  ${wikiData[2][i] ?? ''}\n  ${wikiData[3][i] ?? ''}`)
        .join('\n\n')
      if (wikiResults) return { success: true, output: wikiResults }
    } catch { /* fall through */ }

    return { success: false, output: 'No results found for this query.' }
  } catch (err) {
    return { success: false, output: `Search failed: ${String(err)}` }
  }
}

// ── 2. Write File ─────────────────────────────────────────────────────────────
export async function writeFile(filePath: string, content: string): Promise<ToolResult> {
  try {
    // Confine writes to the workspace — absolute paths and ../ escapes are
    // rejected (the path comes from the LLM, not a trusted caller).
    const base = path.resolve('./agent_workspace')
    const safePath = path.resolve(base, filePath.replace(/^[/\\]+/, ''))
    if (safePath !== base && !safePath.startsWith(base + path.sep)) {
      return { success: false, output: `Write failed: path escapes the workspace (${filePath})` }
    }
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    await fs.writeFile(safePath, content, 'utf8')
    return { success: true, output: `File written to agent_workspace/${filePath}` }
  } catch (err) {
    return { success: false, output: `Write failed: ${String(err)}` }
  }
}

// ── 3. Call External API ──────────────────────────────────────────────────────
export async function callApi(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: unknown
): Promise<ToolResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined || body === null
        ? undefined
        : (typeof body === 'string' ? body : JSON.stringify(body)),
    })
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    return { success: res.ok, output: JSON.stringify(parsed, null, 2).slice(0, 2000) }
  } catch (err) {
    return { success: false, output: `API call failed: ${String(err)}` }
  }
}

// ── 4. Send Email ─────────────────────────────────────────────────────────────
// Delivery lives in mailer.ts, so the agent and the sign-in flow share one
// provider and one set of error messages.
export async function sendEmail(to: string, subject: string, body: string): Promise<ToolResult> {
  const result = await sendMail({ to, subject, text: body })
  return { success: result.ok, output: result.ok ? result.detail : `Email failed: ${result.detail}` }
}

// ── Send the result as a PDF attachment ────────────────────────────────────────
export async function sendPdfEmail(
  to: string,
  subject: string,
  intro: string,
  pdf: Buffer,
  filename = 'equilibrium-report.pdf'
): Promise<ToolResult> {
  const result = await sendMail({
    to,
    subject,
    text: intro,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  })
  return {
    success: result.ok,
    output: result.ok ? `Report emailed to ${to}` : `Email failed: ${result.detail}`,
  }
}

// ── 5. Run Code ───────────────────────────────────────────────────────────────
export async function runCode(code: string): Promise<ToolResult> {
  try {
    const tmpFile = `./agent_workspace/_tmp_${Date.now()}.mjs`
    await fs.mkdir('./agent_workspace', { recursive: true })
    await fs.writeFile(tmpFile, code, 'utf8')
    const { stdout, stderr } = await execAsync(`node ${tmpFile}`, { timeout: 10000, maxBuffer: 10 * 1024 * 1024 })
    await fs.unlink(tmpFile).catch(() => {})
    return { success: true, output: stdout || stderr || '(no output)' }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { success: false, output: e.stderr ?? e.message ?? String(err) }
  }
}

// ── 6. Read URL ───────────────────────────────────────────────────────────────
// Fetch a page and return its readable text. web_search returns titles and
// snippets; this is how an agent actually reads the source it found.
const READ_URL_CAP = 4000

export async function readUrl(url: string): Promise<ToolResult> {
  try {
    const target = url?.trim()
    if (!target) return { success: false, output: 'No URL provided' }

    // The URL comes from the LLM (often lifted out of a search result), so
    // restrict it to public http(s) and refuse loopback/private hosts — an
    // agent must not be able to reach the machine's own services.
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      return { success: false, output: `Not a valid URL: ${target}` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, output: 'Only http(s) URLs can be read.' }
    }
    const host = parsed.hostname.toLowerCase()
    const isPrivate =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '::1' ||
      host === '[::1]'
    if (isPrivate) {
      return { success: false, output: 'Refusing to read a private/loopback address.' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let res: Response
    try {
      res = await fetch(parsed.toString(), {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9' },
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return { success: false, output: `Fetch failed: HTTP ${res.status} for ${parsed.host}` }

    const contentType = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/(xhtml|json)/.test(contentType)) {
      return { success: false, output: `Unsupported content type (${contentType || 'unknown'}) — nothing to read.` }
    }

    const raw = await res.text()
    if (contentType.includes('json')) {
      return { success: true, output: `Source: ${parsed.toString()}\n\n${raw.slice(0, READ_URL_CAP)}` }
    }

    // Strip the chrome, then the tags. Crude, but it turns a page into prose
    // without pulling in a DOM parser.
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Keep block structure as newlines so paragraphs survive.
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')

    const clean = decodeEntities(text)
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()

    if (!clean) return { success: false, output: `No readable text found at ${parsed.host}` }

    const header = `Source: ${parsed.toString()}${title ? `\nTitle: ${decodeEntities(title)}` : ''}`
    const body = clean.slice(0, READ_URL_CAP)
    const truncated = clean.length > READ_URL_CAP ? '\n\n[…truncated]' : ''
    return { success: true, output: `${header}\n\n${body}${truncated}` }
  } catch (err) {
    const aborted = (err as { name?: string })?.name === 'AbortError'
    return { success: false, output: aborted ? 'Fetch timed out after 15s.' : `Read failed: ${String(err)}` }
  }
}

// ── 7. Read / list workspace files ────────────────────────────────────────────
// Lets a later specialist pick up what an earlier one saved, instead of every
// hand-off having to travel through the (capped) conversation context.
const WORKSPACE = () => path.resolve('./agent_workspace')

/** Resolve a workspace-relative path, or null if it escapes the workspace. */
function safeWorkspacePath(rel: string): string | null {
  const base = WORKSPACE()
  const resolved = path.resolve(base, String(rel ?? '').replace(/^[/\\]+/, ''))
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null
  return resolved
}

const READ_FILE_CAP = 4000

export async function readWorkspaceFile(filePath: string): Promise<ToolResult> {
  try {
    const safe = safeWorkspacePath(filePath)
    if (!safe) return { success: false, output: `Read failed: path escapes the workspace (${filePath})` }
    const stat = await fs.stat(safe).catch(() => null)
    if (!stat) return { success: false, output: `No such file: ${filePath}` }
    if (stat.isDirectory()) return { success: false, output: `${filePath} is a directory — use list_files instead.` }
    const content = await fs.readFile(safe, 'utf8')
    const truncated = content.length > READ_FILE_CAP ? '\n\n[…truncated]' : ''
    return { success: true, output: `${content.slice(0, READ_FILE_CAP)}${truncated}` }
  } catch (err) {
    return { success: false, output: `Read failed: ${String(err)}` }
  }
}

export async function listFiles(dir = '.'): Promise<ToolResult> {
  try {
    const safe = safeWorkspacePath(dir)
    if (!safe) return { success: false, output: `List failed: path escapes the workspace (${dir})` }
    const entries = await fs.readdir(safe, { withFileTypes: true }).catch(() => null)
    if (!entries) return { success: true, output: 'The workspace is empty.' }

    const rows: string[] = []
    for (const entry of entries) {
      // Scratch files from run_code are noise to the agent.
      if (entry.name.startsWith('_tmp_') || entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        rows.push(`${entry.name}/`)
        continue
      }
      const stat = await fs.stat(path.join(safe, entry.name)).catch(() => null)
      const kb = stat ? Math.max(1, Math.round(stat.size / 1024)) : 0
      rows.push(`${entry.name} (${kb} KB)`)
    }
    rows.sort()
    if (!rows.length) return { success: true, output: 'No files in the workspace yet.' }
    return { success: true, output: rows.slice(0, 60).map((r) => `• ${r}`).join('\n') }
  } catch (err) {
    return { success: false, output: `List failed: ${String(err)}` }
  }
}

// ── 8. Make Chart ─────────────────────────────────────────────────────────────
// Renders data to a standalone SVG saved in the workspace, so a run can hand
// back a picture of its numbers instead of only a table of them.
export type ChartType = 'bar' | 'line' | 'pie'

const CHART_COLORS = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#2dd4bf', '#f472b6', '#a3e635']

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Pick a "nice" axis maximum (1/2/5 × 10ⁿ) at or above `max`. */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const exp = Math.floor(Math.log10(max))
  const pow = Math.pow(10, exp)
  const frac = max / pow
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return step * pow
}

function renderChartSvg(type: ChartType, title: string, labels: string[], values: number[]): string {
  const W = 720
  const H = 420
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
  <rect width="${W}" height="${H}" rx="16" fill="#0a1410"/>
  <text x="32" y="44" fill="#d1fae5" font-size="20" font-weight="600">${esc(title)}</text>`
  const tail = '</svg>'

  if (type === 'pie') {
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const cx = 250
    const cy = 230
    const r = 130
    let angle = -Math.PI / 2
    const slices = values
      .map((v, i) => {
        const share = Math.max(0, v) / total
        const sweep = share * Math.PI * 2
        const x1 = cx + r * Math.cos(angle)
        const y1 = cy + r * Math.sin(angle)
        angle += sweep
        const x2 = cx + r * Math.cos(angle)
        const y2 = cy + r * Math.sin(angle)
        const large = sweep > Math.PI ? 1 : 0
        const color = CHART_COLORS[i % CHART_COLORS.length]
        // A single 100% slice can't be drawn as an arc — use a full circle.
        const path =
          share >= 0.999
            ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
            : `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}" stroke="#0a1410" stroke-width="2"/>`
        return path
      })
      .join('\n  ')

    const legend = labels
      .map((l, i) => {
        const pct = ((Math.max(0, values[i] ?? 0) / total) * 100).toFixed(1)
        const y = 120 + i * 26
        return `<rect x="470" y="${y - 11}" width="12" height="12" rx="3" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>
  <text x="492" y="${y}" fill="#a7f3d0" font-size="13">${esc(l)} — ${pct}%</text>`
      })
      .join('\n  ')

    return `${head}\n  ${slices}\n  ${legend}\n${tail}`
  }

  // Shared cartesian frame for bar and line.
  const left = 64
  const right = W - 32
  const top = 76
  const bottom = H - 64
  const plotW = right - left
  const plotH = bottom - top
  const max = niceMax(Math.max(...values.map((v) => Math.max(0, v)), 0))

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const y = bottom - (plotH * i) / 4
    const value = (max * i) / 4
    const label = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value * 100) / 100)
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.08"/>
  <text x="${left - 10}" y="${(y + 4).toFixed(1)}" fill="#6ee7b7" fill-opacity="0.7" font-size="11" text-anchor="end">${label}</text>`
  }).join('\n  ')

  // Rotate x labels when there are too many to fit horizontally.
  const rotate = labels.length > 8
  const xLabels = labels
    .map((l, i) => {
      const x = left + (plotW * (i + 0.5)) / labels.length
      const short = l.length > 16 ? `${l.slice(0, 15)}…` : l
      return rotate
        ? `<text x="${x.toFixed(1)}" y="${bottom + 14}" fill="#a7f3d0" fill-opacity="0.75" font-size="11" text-anchor="end" transform="rotate(-40 ${x.toFixed(1)} ${bottom + 14})">${esc(short)}</text>`
        : `<text x="${x.toFixed(1)}" y="${bottom + 20}" fill="#a7f3d0" fill-opacity="0.75" font-size="12" text-anchor="middle">${esc(short)}</text>`
    })
    .join('\n  ')

  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#ffffff" stroke-opacity="0.25"/>`

  if (type === 'line') {
    const points = values.map((v, i) => {
      const x = left + (plotW * (i + 0.5)) / Math.max(1, values.length)
      const y = bottom - (Math.max(0, v) / max) * plotH
      return [x, y] as const
    })
    const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    const area = points.length
      ? `M ${points[0][0].toFixed(1)} ${bottom} ` +
        points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
        ` L ${points[points.length - 1][0].toFixed(1)} ${bottom} Z`
      : ''
    const dots = points
      .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#34d399" stroke="#0a1410" stroke-width="2"/>`)
      .join('\n  ')
    return `${head}
  <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#34d399" stop-opacity="0.35"/><stop offset="100%" stop-color="#34d399" stop-opacity="0"/>
  </linearGradient></defs>
  ${gridLines}
  ${axis}
  <path d="${area}" fill="url(#fade)"/>
  <path d="${d}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${xLabels}
${tail}`
  }

  const slot = plotW / Math.max(1, values.length)
  const barW = Math.max(6, Math.min(64, slot * 0.6))
  const bars = values
    .map((v, i) => {
      const h = (Math.max(0, v) / max) * plotH
      const x = left + slot * (i + 0.5) - barW / 2
      const y = bottom - h
      const color = CHART_COLORS[i % CHART_COLORS.length]
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="5" fill="${color}"/>
  <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" fill="#d1fae5" font-size="11" text-anchor="middle">${esc(String(v))}</text>`
    })
    .join('\n  ')

  return `${head}\n  ${gridLines}\n  ${axis}\n  ${bars}\n  ${xLabels}\n${tail}`
}

export async function makeChart(
  type: string,
  title: string,
  labels: unknown,
  values: unknown,
  filePath?: string
): Promise<ToolResult> {
  try {
    const kind: ChartType = type === 'line' ? 'line' : type === 'pie' ? 'pie' : 'bar'

    const labelList = (Array.isArray(labels) ? labels : []).map((l) => String(l)).slice(0, 24)
    const valueList = (Array.isArray(values) ? values : [])
      .map((v) => {
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''))
        return Number.isFinite(n) ? n : 0
      })
      .slice(0, 24)

    if (!valueList.length) return { success: false, output: 'make_chart needs a non-empty numeric "values" array.' }

    // Tolerate a labels/values length mismatch rather than refusing the call.
    const n = Math.max(labelList.length, valueList.length)
    const finalLabels = Array.from({ length: n }, (_, i) => labelList[i] ?? `#${i + 1}`)
    const finalValues = Array.from({ length: n }, (_, i) => valueList[i] ?? 0)

    const heading = String(title ?? '').trim() || 'Chart'
    const svg = renderChartSvg(kind, heading, finalLabels, finalValues)

    let name = String(filePath ?? '').trim()
    if (!name) {
      name = `${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'chart'}.svg`
    }
    if (!/\.svg$/i.test(name)) name = `${name}.svg`

    const written = await writeFile(name, svg)
    if (!written.success) return written
    return {
      success: true,
      output: `Chart saved to agent_workspace/${name} (${kind} chart, ${n} data points: ${finalLabels
        .slice(0, 6)
        .join(', ')}${n > 6 ? '…' : ''})`,
    }
  } catch (err) {
    return { success: false, output: `Chart failed: ${String(err)}` }
  }
}

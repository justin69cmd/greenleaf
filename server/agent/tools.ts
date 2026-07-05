import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import nodemailer from 'nodemailer'

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
export async function sendEmail(to: string, subject: string, body: string): Promise<ToolResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text: body })
    return { success: true, output: `Email sent to ${to}` }
  } catch (err) {
    return { success: false, output: `Email failed: ${String(err)}` }
  }
}

// ── Send the result as a PDF attachment ────────────────────────────────────────
export async function sendPdfEmail(
  to: string,
  subject: string,
  intro: string,
  pdf: Buffer,
  filename = 'equilibrium-report.pdf'
): Promise<ToolResult> {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return { success: false, output: 'Email not configured (missing SMTP_USER / SMTP_PASS).' }
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      text: intro,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    })
    return { success: true, output: `Report emailed to ${to}` }
  } catch (err) {
    return { success: false, output: `Email failed: ${String(err)}` }
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

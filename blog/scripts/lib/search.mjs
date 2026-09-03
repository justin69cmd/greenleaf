// Keyless web search via DuckDuckGo's no-JS HTML endpoint, so every generated
// post can carry REAL reference links "from the net" without an API key.
// (Same technique the GreenLeaf agent's web_search tool uses.)

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function decodeEntities(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

// DuckDuckGo wraps result links in a redirect (//duckduckgo.com/l/?uddg=...).
// Unwrap to the real destination URL.
function cleanUrl(href) {
  try {
    if (!href) return null
    let u = href.startsWith('//') ? 'https:' + href : href
    const parsed = new URL(u)
    const target = parsed.searchParams.get('uddg')
    if (target) return decodeURIComponent(target)
    return parsed.href
  } catch {
    return null
  }
}

/**
 * Returns up to `limit` real results: [{ title, url, publisher }]
 * Prefers reputable sources when a preferDomains list is given.
 */
export async function webSearch(query, { limit = 5, preferDomains = [] } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  let html = ''
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    html = await res.text()
  } catch {
    return []
  }

  const rowRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const results = []
  let m
  while ((m = rowRe.exec(html)) !== null) {
    const link = cleanUrl(m[1])
    const title = decodeEntities(m[2])
    if (!link || !title) continue
    let publisher = ''
    try {
      publisher = new URL(link).hostname.replace(/^www\./, '')
    } catch {}
    results.push({ title, url: link, publisher })
  }

  // Rank preferred domains (e.g. .gov / .edu / known health orgs) first.
  const score = (r) => {
    const h = r.publisher
    if (preferDomains.some((d) => h.endsWith(d))) return 0
    if (h.endsWith('.gov') || h.endsWith('.edu')) return 1
    if (h.endsWith('.org')) return 2
    return 3
  }
  results.sort((a, b) => score(a) - score(b))

  // De-dupe by hostname so we don't cite the same site five times.
  const seen = new Set()
  const out = []
  for (const r of results) {
    if (seen.has(r.publisher)) continue
    seen.add(r.publisher)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

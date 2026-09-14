import dns from 'dns/promises'
import net from 'net'

// ── Outbound requests the agents make ─────────────────────────────────────────
// read_url and call_api fetch URLs chosen by a model — often lifted out of a web
// page the model just read, which means lifted out of text anyone can write.
// Neither may reach the machine's own services, the private network it sits on,
// or a cloud metadata endpoint.
//
// Checking the hostname string isn't enough: `127.0.0.1.nip.io` is a public
// name that resolves to loopback, and a public page can redirect to
// http://169.254.169.254/. So the name is resolved and every address checked,
// and redirects are followed by hand with the same check on each hop.
//
// What remains is DNS rebinding (a name that answers differently between our
// lookup and fetch's). Closing that needs pinning the connection to the checked
// address, which Node's fetch doesn't expose; the window is milliseconds.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  )
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Private(ip)
  if (!net.isIPv6(ip)) return true // not an address at all — refuse
  const v6 = ip.toLowerCase()
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return ipv4Private(mapped[1])
  return (
    v6 === '::' ||
    v6 === '::1' ||
    /^f[cd]/.test(v6) || // unique local fc00::/7
    /^fe[89ab]/.test(v6) || // link-local fe80::/10
    /^ff/.test(v6) || // multicast
    v6.startsWith('::ffff:') // mapped addresses in hex form
  )
}

/** Parse and vet a URL. Throws BlockedUrlError with a message the agent can read. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http(s) URLs are allowed.')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || /\.(localhost|internal|local)$/.test(host)) {
    throw new BlockedUrlError('Refusing to reach a private/loopback address.')
  }

  let addresses: string[]
  if (net.isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address)
    } catch {
      throw new BlockedUrlError(`Could not resolve ${host}.`)
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError('Refusing to reach a private/loopback address.')
  }
  return url
}

const MAX_REDIRECTS = 5

/**
 * fetch() for model-chosen URLs: every hop, including redirects, must resolve
 * to a public address. Returns the final response and the URL it came from.
 */
export async function publicFetch(raw: string, init: RequestInit = {}): Promise<{ res: Response; url: URL }> {
  let url = await assertPublicUrl(raw)
  let { method = 'GET', body } = init

  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...init, method, body, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return { res, url }

    if (hop >= MAX_REDIRECTS) throw new BlockedUrlError(`Too many redirects from ${url.host}.`)
    await res.body?.cancel().catch(() => {})
    url = await assertPublicUrl(new URL(location, url).toString())
    // Same method rewrite browsers do: 303 always, and 301/302 for a POST.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method.toUpperCase() === 'POST')) {
      method = 'GET'
      body = undefined
    }
  }
}

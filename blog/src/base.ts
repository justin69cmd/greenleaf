// Base-path helpers so every internal link and local asset works whether the
// blog is served at the domain root (BASE_PATH=/) or mounted under /blog.
const BASE = import.meta.env.BASE_URL // e.g. "/blog/" or "/"

/** Prefix an internal route/path with the configured base. */
export function withBase(path = '/'): string {
  const b = BASE.replace(/\/+$/, '') // strip trailing slash(es)
  const p = path.startsWith('/') ? path : `/${path}`
  const out = `${b}${p}`
  return out === '' ? '/' : out
}

/** Resolve an image/asset src: remote URLs pass through, local paths get the base. */
export function assetUrl(src?: string): string | undefined {
  if (!src) return undefined
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src
  return withBase(src)
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}

export function yamlEscape(s) {
  // Double-quote and escape for a YAML scalar.
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function readingTimeFromText(text) {
  const words = String(text).trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 220))
}

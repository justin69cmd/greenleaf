// Load blog/.env into process.env (no dependency). Existing env vars win.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const k = m[1]
    let v = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v
  }
} catch { /* no .env — rely on real environment */ }

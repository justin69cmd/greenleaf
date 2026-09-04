#!/usr/bin/env node
/**
 * Unattended runner: generates ALL pending topics in batches until the library
 * is complete. Start it once on a machine with internet (your Mac) and walk away.
 *
 *   node scripts/generate-all.mjs               # grind through everything
 *   BATCH_SIZE=25 node scripts/generate-all.mjs # tune batch size
 *
 * - Resumable: skips anything already written, so you can stop/restart anytime.
 * - Rate-limit aware: if a round makes no progress (free-tier quota hit), it
 *   backs off (1m → 2m → 5m → 10m) and keeps trying instead of giving up.
 * - Logs every round and a final summary.
 *
 * Needs NVIDIA_API_KEY in .env. Optional UNSPLASH_ACCESS_KEY / PEXELS_API_KEY.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { slugify, sleep } from './lib/util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BLOG_DIR = path.resolve(__dirname, '../src/content/blog')
const TOPICS_FILE = path.join(__dirname, 'topics.json')

const BATCH = Number(process.env.BATCH_SIZE || 25)
const BACKOFFS = [60, 120, 300, 600] // seconds, when a round makes no progress
const MAX_STALLS = 8 // give up after this many consecutive no-progress rounds

function doneSlugs() {
  try {
    return new Set(fs.readdirSync(BLOG_DIR).map((f) => f.replace(/\.(md|mdx)$/, '')))
  } catch {
    return new Set()
  }
}
function pendingCount() {
  const topics = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))
  const done = doneSlugs()
  return topics.filter((t) => !done.has(t.slug || slugify(t.title))).length
}

async function main() {
  let pending = pendingCount()
  const startPending = pending
  console.log(`\n🌿 GreenLeaf unattended generator`)
  console.log(`   ${pending} topics to write, ${BATCH} per batch. Starting…\n`)

  let stalls = 0
  let round = 0
  const t0 = Date.now()

  while (pending > 0) {
    round++
    const before = pending
    console.log(`\n─── Round ${round} · ${before} pending ───`)

    const res = spawnSync('node', ['scripts/generate-posts.mjs', String(BATCH)], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    })
    if (res.error) console.warn(`   (round error: ${res.error.message})`)

    pending = pendingCount()
    const wrote = before - pending
    const elapsedMin = Math.round((Date.now() - t0) / 60000)
    console.log(`   Round ${round}: wrote ${wrote} · ${pending} left · ${startPending - pending}/${startPending} done · ${elapsedMin}m elapsed`)

    if (pending === 0) break

    if (wrote > 0) {
      stalls = 0
      await sleep(8000) // small breather between productive rounds
    } else {
      const wait = BACKOFFS[Math.min(stalls, BACKOFFS.length - 1)]
      stalls++
      if (stalls > MAX_STALLS) {
        console.error(`\n⛔ No progress for ${MAX_STALLS} rounds — likely out of quota or offline.`)
        console.error(`   ${pending} topics still pending. Re-run this command later to resume.`)
        process.exit(1)
      }
      console.log(`   No progress (quota/rate limit?). Backing off ${wait}s… (stall ${stalls}/${MAX_STALLS})`)
      await sleep(wait * 1000)
    }
  }

  const mins = Math.round((Date.now() - t0) / 60000)
  console.log(`\n✅ All done. ${startPending} articles generated in ~${mins} minutes.`)
  console.log(`   Next: from the repo root run  npm run build:site  then deploy.\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

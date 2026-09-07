#!/usr/bin/env node
import "./lib/env.mjs"
/**
 * Upgrade posts that are still using a local fallback hero (/heroes/*.svg) to a
 * real licensed image, once you've added UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.
 *
 *   node scripts/fetch-images.mjs           # upgrade fallback heroes in place
 *   node scripts/fetch-images.mjs --list    # just list posts using a fallback
 *
 * Operates only on the consistent frontmatter this pipeline produces.
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { sourceImage } from './lib/images.mjs'
import { yamlEscape, sleep } from './lib/util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BLOG_DIR = path.resolve(__dirname, '../src/content/blog')
const listOnly = process.argv.includes('--list')

function getField(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'))
  return m ? m[1] : undefined
}

function stripCredit(fm) {
  // Remove an existing "imageCredit:" block (the key + its indented children).
  return fm.replace(/^imageCredit:\n(?:[ \t]+.*\n?)*/m, '')
}

async function main() {
  const hasKey = process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY
  const files = (await fs.readdir(BLOG_DIR)).filter((f) => /\.mdx?$/.test(f))
  let fallbackCount = 0
  let upgraded = 0

  for (const file of files) {
    const full = path.join(BLOG_DIR, file)
    const src = await fs.readFile(full, 'utf8')
    const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/)
    if (!fmMatch) continue
    let fm = fmMatch[1]
    const hero = getField(fm, 'heroImage') || ''
    if (!hero.startsWith('/heroes/')) continue // already a real image
    fallbackCount++
    const category = getField(fm, 'category') || 'Mindfulness'
    const title = getField(fm, 'title') || file

    if (listOnly) {
      console.log(`  • ${file}  [${category}]`)
      continue
    }
    if (!hasKey) continue

    const image = await sourceImage({ query: title, category, alt: title })
    if (image.heroImage.startsWith('/heroes/')) continue // still no real image found

    fm = stripCredit(fm)
    fm = fm.replace(/^heroImage:.*$/m, `heroImage: ${yamlEscape(image.heroImage)}`)
    fm = fm.replace(/^heroAlt:.*$/m, `heroAlt: ${yamlEscape(image.heroAlt || title)}`)
    let creditBlock = ''
    if (image.imageCredit) {
      creditBlock =
        `imageCredit:\n  author: ${yamlEscape(image.imageCredit.author)}\n` +
        `  source: ${yamlEscape(image.imageCredit.source)}\n  link: ${yamlEscape(image.imageCredit.link)}\n`
    }
    // Insert credit right after the aiImage line.
    fm = fm.replace(/^(aiImage:.*)$/m, `$1\n${creditBlock}`.trimEnd())

    const rebuilt = `---\n${fm}\n---\n` + src.slice(fmMatch[0].length)
    await fs.writeFile(full, rebuilt, 'utf8')
    upgraded++
    console.log(`   ✓ upgraded hero for ${file}`)
    await sleep(800)
  }

  if (listOnly) console.log(`\n${fallbackCount} post(s) using a fallback hero.`)
  else if (!hasKey) console.log(`\n${fallbackCount} post(s) use a fallback hero. Add UNSPLASH_ACCESS_KEY or PEXELS_API_KEY to .env, then re-run.`)
  else console.log(`\n🌿 Upgraded ${upgraded}/${fallbackCount} fallback heroes.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

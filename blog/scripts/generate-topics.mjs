#!/usr/bin/env node
import "./lib/env.mjs"
/**
 * Expand scripts/topics.json with fresh, specific article ideas per category —
 * this is how you scale toward thousands of posts without hand-writing titles.
 *
 *   node scripts/generate-topics.mjs           # ~30 new ideas per category
 *   node scripts/generate-topics.mjs 60        # ~60 new ideas per category
 *
 * Deduplicates against existing titles/slugs. Requires NVIDIA_API_KEY.
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { chat, extractJson } from './lib/llm.mjs'
import { slugify, sleep } from './lib/util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOPICS_FILE = path.join(__dirname, 'topics.json')

const CATEGORIES = [
  'Mindfulness',
  'Nutrition',
  'Movement',
  'Sleep',
  'Mental Health',
  'Habits & Productivity',
  'Longevity',
  'Relationships',
]

const perCat = Number(process.argv[2] || 30)

function prompt(category, count, avoid) {
  return [
    { role: 'system', content: 'You generate specific, non-clickbait wellness article titles for a general audience. Titles are concrete and practical, not vague. No numbers-only listicles unless genuinely useful.' },
    {
      role: 'user',
      content: `Give me ${count} distinct article titles for the category "${category}" of a wellness blog.
Avoid anything close to these existing titles:
${avoid.slice(0, 40).join('\n') || '(none yet)'}

Return ONLY JSON: {"titles": ["...", "..."]}. Each title under 90 characters.`,
    },
  ]
}

async function main() {
  const raw = await fs.readFile(TOPICS_FILE, 'utf8').catch(() => '[]')
  const topics = JSON.parse(raw)
  const seen = new Set(topics.map((t) => t.slug || slugify(t.title)))
  const existingTitles = topics.map((t) => t.title)

  let added = 0
  for (const category of CATEGORIES) {
    try {
      const out = await chat(prompt(category, perCat, existingTitles), { json: true, temperature: 0.9, maxTokens: 1600 })
      const parsed = extractJson(out)
      const titles = Array.isArray(parsed?.titles) ? parsed.titles : []
      for (const title of titles) {
        const slug = slugify(title)
        if (!title || seen.has(slug)) continue
        seen.add(slug)
        topics.push({ title: String(title).trim(), slug, category, tags: [] })
        existingTitles.push(title)
        added++
      }
      console.log(`  + ${category}: now ${topics.filter((t) => t.category === category).length} topics`)
      await sleep(1000)
    } catch (err) {
      console.warn(`  ⚠️  ${category}: ${err.message}`)
    }
  }

  await fs.writeFile(TOPICS_FILE, JSON.stringify(topics, null, 2) + '\n', 'utf8')
  console.log(`\n🌱 Added ${added} new topics. Total: ${topics.length}. Now run: npm run generate`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

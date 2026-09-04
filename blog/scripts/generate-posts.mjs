#!/usr/bin/env node
/**
 * Batch-generate LONG wellness blog posts as MDX, with inline images hotlinked
 * from the web (never downloaded) and real reference links.
 *
 *   node scripts/generate-posts.mjs            # generate BATCH_SIZE posts
 *   node scripts/generate-posts.mjs 50         # generate 50 this run
 *   node scripts/generate-posts.mjs --dry      # preview which topics would run
 *
 * Safe to run repeatedly: it skips topics that already have a post file, so you
 * scale toward thousands by running it in batches (respecting your LLM quota).
 *
 * Runs anywhere with normal internet + an NVIDIA_API_KEY in .env (e.g. your Mac
 * terminal). Add UNSPLASH_ACCESS_KEY / PEXELS_API_KEY for higher-quality,
 * properly-attributed photos; without them it uses keyless topical images.
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { chat, extractJson } from './lib/llm.mjs'
import { webSearch } from './lib/search.mjs'
import { sourceImage, sourceInlineImages } from './lib/images.mjs'
import { slugify, yamlEscape, todayISO, readingTimeFromText, sleep } from './lib/util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BLOG_DIR = path.join(ROOT, 'src/content/blog')
const TOPICS_FILE = path.join(__dirname, 'topics.json')

const REPUTABLE = ['who.int', 'cdc.gov', 'nih.gov', 'harvard.edu', 'mayoclinic.org', 'sleepfoundation.org', 'nhs.uk']
const INLINE_IMAGES = Number(process.env.INLINE_IMAGES || 3)

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const batchArg = args.find((a) => /^\d+$/.test(a))
const BATCH = Number(batchArg || process.env.BATCH_SIZE || 25)

function articlePrompt(topic, sources) {
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n') || '(no sources found — write carefully and generally)'
  return [
    {
      role: 'system',
      content:
        'You are a careful, engaging wellness writer for the GreenLeaf Journal. You write in-depth, practical, warm long-form articles a general adult can act on. You never give medical advice or make clinical claims; you add a brief "general information, not medical advice" note where relevant. You ground statements in the provided sources and never invent statistics.',
    },
    {
      role: 'user',
      content: `Write a LONG, in-depth article titled "${topic.title}" for the category "${topic.category}".

Use these real sources as grounding (do not fabricate others):
${sourceList}

Return ONLY a JSON object with these keys:
{
  "description": "a 1-2 sentence meta description under 300 characters",
  "tags": ["4-6 short lowercase tags"],
  "body": "the article in GitHub-flavored Markdown"
}

Rules for "body":
- 1500-2000 words. Be genuinely thorough — this is a flagship long-form piece.
- Do NOT include the title as an H1 and do NOT include front matter or images (images are added automatically).
- Open with 2-3 short intro paragraphs, then use SIX to NINE "## " subheadings.
- Under headings, use a mix of substantial paragraphs and the occasional bullet list.
- Include at least one ">" blockquote with a memorable takeaway.
- Include a "## Frequently asked questions" section near the end with 3-4 Q&As (use "### " for each question).
- Be specific, concrete, and practical throughout; no filler, no placeholders, no repetition.
- End with a brief, kind reminder that this is general information, not medical advice.
- Return valid JSON only, with the body as a single JSON string (escape newlines).`,
    },
  ]
}

// Insert remote-image <figure> blocks between sections of the markdown body.
function insertInlineImages(body, images) {
  if (!images.length) return body
  const lines = body.split('\n')
  const headingIdx = []
  lines.forEach((l, i) => { if (/^##\s+/.test(l) && !/^###/.test(l)) headingIdx.push(i) })
  if (headingIdx.length < 2) return body

  // Choose spread-out insertion points (before the 2nd, 4th, 6th… heading).
  const points = []
  for (let k = 1; k < headingIdx.length && points.length < images.length; k += 2) points.push(headingIdx[k])

  // Insert bottom-up so earlier indices stay valid.
  for (let p = points.length - 1; p >= 0; p--) {
    const img = images[p]
    const fig = [
      '',
      '<figure>',
      `  <img src="${img.url}" alt="${(img.alt || '').replace(/"/g, '')}" loading="lazy" />`,
      `  <figcaption>Photo by <a href="${img.credit.link}" target="_blank" rel="noopener nofollow">${img.credit.author}</a> on ${img.credit.source}</figcaption>`,
      '</figure>',
      '',
    ].join('\n')
    lines.splice(points[p], 0, fig)
  }
  return lines.join('\n')
}

async function existingSlugs() {
  try {
    const files = await fs.readdir(BLOG_DIR)
    return new Set(files.map((f) => f.replace(/\.(md|mdx)$/, '')))
  } catch {
    return new Set()
  }
}

function buildMdx(topic, { description, tags, body }, image, references, readingTime) {
  const fm = []
  fm.push('---')
  fm.push(`title: ${yamlEscape(topic.title)}`)
  fm.push(`description: ${yamlEscape(description)}`)
  fm.push(`pubDate: ${todayISO()}`)
  fm.push(`category: ${yamlEscape(topic.category)}`)
  fm.push(`tags: [${(tags || topic.tags || []).map((t) => yamlEscape(t)).join(', ')}]`)
  fm.push(`heroImage: ${yamlEscape(image.heroImage)}`)
  fm.push(`heroAlt: ${yamlEscape(image.heroAlt || topic.title)}`)
  fm.push(`aiImage: ${image.aiImage ? 'true' : 'false'}`)
  if (image.imageCredit) {
    fm.push('imageCredit:')
    fm.push(`  author: ${yamlEscape(image.imageCredit.author)}`)
    fm.push(`  source: ${yamlEscape(image.imageCredit.source)}`)
    fm.push(`  link: ${yamlEscape(image.imageCredit.link)}`)
  }
  fm.push(`author: "GreenLeaf Editorial"`)
  fm.push(`readingTime: ${readingTime}`)
  if (references.length) {
    fm.push('references:')
    for (const r of references) {
      fm.push(`  - title: ${yamlEscape(r.title)}`)
      fm.push(`    url: ${yamlEscape(r.url)}`)
      if (r.publisher) fm.push(`    publisher: ${yamlEscape(r.publisher)}`)
    }
  } else {
    fm.push('references: []')
  }
  fm.push('---')
  return fm.join('\n') + '\n\n' + body.trim() + '\n'
}

async function main() {
  const raw = await fs.readFile(TOPICS_FILE, 'utf8').catch(() => '[]')
  const topics = JSON.parse(raw)
  const done = await existingSlugs()
  const pending = topics.filter((t) => !done.has(t.slug || slugify(t.title)))

  console.log(`📚 ${topics.length} topics total · ${done.size} already written · ${pending.length} pending`)
  const batch = pending.slice(0, BATCH)
  if (!batch.length) {
    console.log('✅ Nothing to generate. Add topics with: npm run generate:topics')
    return
  }
  if (dry) {
    console.log(`\n(dry run) would generate ${batch.length}:`)
    batch.forEach((t) => console.log(`  • [${t.category}] ${t.title}`))
    return
  }

  await fs.mkdir(BLOG_DIR, { recursive: true })
  let ok = 0
  for (const topic of batch) {
    const slug = topic.slug || slugify(topic.title)
    try {
      process.stdout.write(`\n✍️  ${topic.title}\n`)
      const sources = await webSearch(`${topic.title} ${topic.category}`, { limit: 5, preferDomains: REPUTABLE })
      const out = await chat(articlePrompt(topic, sources), { json: true, maxTokens: 4096, temperature: 0.6 })
      const parsed = extractJson(out)
      if (!parsed?.body) {
        console.warn('   ⚠️  skipped — model did not return a usable body')
        continue
      }
      const imgQuery = topic.imageQuery || `${topic.title}`
      const [hero, inline] = await Promise.all([
        sourceImage({ query: imgQuery, category: topic.category, alt: topic.title }),
        sourceInlineImages({ query: imgQuery, category: topic.category, count: INLINE_IMAGES, alt: topic.title }),
      ])
      const bodyWithImages = insertInlineImages(parsed.body, inline)
      const readingTime = readingTimeFromText(bodyWithImages)
      const mdx = buildMdx(topic, { ...parsed, body: bodyWithImages }, hero, sources, readingTime)
      await fs.writeFile(path.join(BLOG_DIR, `${slug}.mdx`), mdx, 'utf8')
      ok++
      console.log(`   ✓ ${slug}.mdx — ${readingTime} min, ${sources.length} refs, ${inline.length} inline images`)
      await sleep(1200) // be gentle on the free LLM + search endpoints
    } catch (err) {
      console.warn(`   ⚠️  ${slug} failed: ${err.message}`)
      await sleep(2500)
    }
  }
  console.log(`\n🌿 Done. Wrote ${ok}/${batch.length} posts. Run again for the next batch.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import type { CollectionEntry } from 'astro:content'
import { slugifyTag } from './consts'

export type Post = CollectionEntry<'blog'>

// Resolve a hero image (local ImageMetadata OR remote URL string) to a src.
export function heroSrc(hero: unknown): string | undefined {
  if (!hero) return undefined
  if (typeof hero === 'string') return hero
  if (typeof hero === 'object' && hero !== null && 'src' in hero) {
    return (hero as { src: string }).src
  }
  return undefined
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function isoDate(date: Date): string {
  return date.toISOString()
}

// Rough reading-time estimate from rendered body length (words / 220 wpm).
export function readingTime(body: string | undefined): number {
  if (!body) return 1
  const words = body.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 220))
}

// Newest-first, drafts excluded (drafts still build in dev for previewing).
export function sortPosts(posts: Post[]): Post[] {
  return posts
    .filter((p) => import.meta.env.DEV || !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export interface TagInfo {
  /** The most common spelling of the tag across posts. */
  label: string
  slug: string
  count: number
}

/**
 * Collect every tag across the given posts, folded by slug.
 * The label kept is the spelling used most often, so an archive page reads the
 * way the writers actually write it.
 */
export function allTags(posts: Post[]): TagInfo[] {
  const bySlug = new Map<string, { counts: Map<string, number>; total: number }>()

  for (const post of posts) {
    for (const raw of post.data.tags) {
      const tag = raw.trim()
      if (!tag) continue
      const slug = slugifyTag(tag)
      if (!slug) continue
      const entry = bySlug.get(slug) ?? { counts: new Map<string, number>(), total: 0 }
      entry.counts.set(tag, (entry.counts.get(tag) ?? 0) + 1)
      entry.total += 1
      bySlug.set(slug, entry)
    }
  }

  return [...bySlug.entries()]
    .map(([slug, { counts, total }]) => ({
      slug,
      count: total,
      label: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function postsWithTag(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => p.data.tags.some((t) => slugifyTag(t) === slug))
}

// ── Related posts ─────────────────────────────────────────────────────────────

/**
 * Rank other posts by how much they share with `post`: a shared tag is worth
 * more than a shared category, and recency breaks ties. Falls back to the
 * newest posts in the same category so the section is never empty on a young
 * blog with few tags.
 */
export function relatedPosts(post: Post, all: Post[], limit = 3): Post[] {
  const tags = new Set(post.data.tags.map(slugifyTag))
  const candidates = all.filter((p) => p.id !== post.id)

  const scored = candidates
    .map((p) => {
      const shared = p.data.tags.filter((t) => tags.has(slugifyTag(t))).length
      const sameCategory = p.data.category === post.data.category ? 1 : 0
      return { post: p, score: shared * 3 + sameCategory }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf())

  const picked = scored.slice(0, limit).map((s) => s.post)
  if (picked.length >= limit) return picked

  const seen = new Set([post.id, ...picked.map((p) => p.id)])
  return [...picked, ...candidates.filter((p) => !seen.has(p.id))].slice(0, limit)
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Strip MDX/Markdown down to prose, for the search index and plain excerpts. */
export function plainText(body: string | undefined, limit = 1200): string {
  if (!body) return ''
  return body
    .replace(/^---[\s\S]*?---/, '')                       // frontmatter
    .replace(/```[\s\S]*?```/g, ' ')                      // fenced code
    .replace(/^import\s+.*$/gm, ' ')                       // MDX imports
    .replace(/<[^>]+>/g, ' ')                              // JSX/HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                 // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')               // links → text
    .replace(/[#>*_`~|-]+/g, ' ')                          // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

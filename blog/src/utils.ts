import type { CollectionEntry } from 'astro:content'

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

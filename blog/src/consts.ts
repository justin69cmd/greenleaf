// Central blog configuration — edit these once.
export const SITE_TITLE = 'GreenLeaf Journal'
export const SITE_TAGLINE = 'Calm, evidence-aware writing on wellness & living well'
export const SITE_DESCRIPTION =
  'The GreenLeaf Journal — practical, well-referenced articles on wellness, mindfulness, movement, nutrition, sleep, and building a calmer daily routine.'

// How many posts per index "part" (page).
export const PAGE_SIZE = 12

// The "parts" of the blog — top-level categories shown in the rail.
// Add/rename freely; posts reference these by their `category` frontmatter.
export const CATEGORIES = [
  'Mindfulness',
  'Nutrition',
  'Movement',
  'Sleep',
  'Mental Health',
  'Habits & Productivity',
  'Longevity',
  'Relationships',
] as const

export type Category = (typeof CATEGORIES)[number]

export function slugifyCategory(c: string): string {
  return c.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

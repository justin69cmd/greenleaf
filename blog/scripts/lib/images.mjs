// Source a hero image for a post, in priority order:
//   1. Unsplash  (needs UNSPLASH_ACCESS_KEY)  — attribution required
//   2. Pexels    (needs PEXELS_API_KEY)       — attribution appreciated
//   3. Wikimedia Commons (no key)             — attribution + license vary
//   4. Local category SVG fallback (/heroes/<category>.svg)
//
// Returns: { heroImage, heroAlt, imageCredit?: {author, source, link}, aiImage:false }
//
// NOTE ON AI IMAGES: the user's "mix of licensed + AI" plan means some posts
// should get an original generated image instead. Wire your image model in
// generateAiImage() below (e.g. save a PNG to public/heroes/generated/<slug>.png
// and return its path). Until then, the pipeline uses licensed stock + the SVG
// fallback, which are always safe to ship.

import { slugify } from './util.mjs'

const CATEGORY_FALLBACK = {
  sleep: '/heroes/sleep.svg',
  mindfulness: '/heroes/mindfulness.svg',
  nutrition: '/heroes/nutrition.svg',
  movement: '/heroes/movement.svg',
  'habits-and-productivity': '/heroes/habits.svg',
  'mental-health': '/heroes/mentalhealth.svg',
}

function fallback(category, alt) {
  const key = slugify(category)
  return {
    heroImage: CATEGORY_FALLBACK[key] || '/heroes/mindfulness.svg',
    heroAlt: alt,
    aiImage: false,
  }
}

async function tryUnsplash(query, alt) {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return null
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&content_filter=high`
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } })
    if (!res.ok) return null
    const data = await res.json()
    const p = data?.results?.[0]
    if (!p) return null
    return {
      heroImage: `${p.urls.raw}&w=1200&h=675&fit=crop&q=80`,
      heroAlt: p.alt_description || alt,
      imageCredit: {
        author: p.user?.name || 'Unsplash contributor',
        source: 'Unsplash',
        link: p.links?.html || 'https://unsplash.com',
      },
      aiImage: false,
    }
  } catch {
    return null
  }
}

async function tryPexels(query, alt) {
  const key = process.env.PEXELS_API_KEY
  if (!key) return null
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`
    const res = await fetch(url, { headers: { Authorization: key } })
    if (!res.ok) return null
    const data = await res.json()
    const p = data?.photos?.[0]
    if (!p) return null
    return {
      heroImage: p.src?.large2x || p.src?.large || p.src?.original,
      heroAlt: p.alt || alt,
      imageCredit: { author: p.photographer || 'Pexels contributor', source: 'Pexels', link: p.url || 'https://pexels.com' },
      aiImage: false,
    }
  } catch {
    return null
  }
}

async function tryWikimedia(query, alt) {
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + query)}&gsrlimit=1&gsrnamespace=6` +
      `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200`
    const res = await fetch(url, { headers: { 'User-Agent': 'GreenLeafBlog/0.1 (wellness blog)' } })
    if (!res.ok) return null
    const data = await res.json()
    const pages = data?.query?.pages
    if (!pages) return null
    const page = Object.values(pages)[0]
    const info = page?.imageinfo?.[0]
    if (!info?.thumburl) return null
    const meta = info.extmetadata || {}
    const artist = (meta.Artist?.value || 'Wikimedia contributor').replace(/<[^>]+>/g, '').trim()
    return {
      heroImage: info.thumburl,
      heroAlt: alt,
      imageCredit: { author: artist, source: 'Wikimedia Commons', link: info.descriptionurl || info.url },
      aiImage: false,
    }
  } catch {
    return null
  }
}

// Hook for the "AI image" half of the mix. Return the same shape with
// aiImage:true, or null to skip. Left unimplemented so the pipeline never
// depends on an image model being configured.
async function generateAiImage(/* topic, slug */) {
  return null
}

export async function sourceImage({ query, category, alt, preferAi = false }) {
  if (preferAi) {
    const ai = await generateAiImage(query)
    if (ai) return ai
  }
  return (
    (await tryUnsplash(query, alt)) ||
    (await tryPexels(query, alt)) ||
    (await tryWikimedia(query, alt)) ||
    fallback(category, alt)
  )
}

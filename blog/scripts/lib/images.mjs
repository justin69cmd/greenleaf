// Source images for a post as REMOTE URLs (never downloaded), in priority order:
//   1. Unsplash  (needs UNSPLASH_ACCESS_KEY)  — attribution required
//   2. Pexels    (needs PEXELS_API_KEY)       — attribution appreciated
//   3. Wikimedia Commons (no key)             — attribution + license vary
//   4. LoremFlickr (no key)                   — topical Flickr Creative-Commons
//   5. Local category SVG fallback (hero only)
//
// hero:   sourceImage()        -> one { heroImage, heroAlt, imageCredit?, aiImage:false }
// inline: sourceInlineImages() -> [{ url, alt, credit:{author,source,link} }]
//
// Every image is a hotlink (a URL). Nothing is written to disk.

import { slugify } from './util.mjs'

const CATEGORY_FALLBACK = {
  sleep: '/heroes/sleep.svg',
  mindfulness: '/heroes/mindfulness.svg',
  nutrition: '/heroes/nutrition.svg',
  movement: '/heroes/movement.svg',
  'habits-and-productivity': '/heroes/habits.svg',
  'mental-health': '/heroes/mentalhealth.svg',
}

function svgFallback(category, alt) {
  const key = slugify(category)
  return { heroImage: CATEGORY_FALLBACK[key] || '/heroes/mindfulness.svg', heroAlt: alt, aiImage: false }
}

// ── LoremFlickr: keyless, topical Creative-Commons images by keyword ──────────
// Stable per (query, seed) thanks to ?lock. Great when no API key is set.
function loremflickrUrl(query, seed = 1, w = 1200, h = 675) {
  const kw = query.toLowerCase().replace(/[^a-z0-9, ]/g, '').trim().replace(/\s+/g, ',')
  return `https://loremflickr.com/${w}/${h}/${encodeURIComponent(kw)}?lock=${seed}`
}
function loremflickrImage(query, seed, alt) {
  return {
    url: loremflickrUrl(query, seed),
    alt,
    credit: { author: 'Flickr (Creative Commons)', source: 'LoremFlickr', link: 'https://loremflickr.com' },
  }
}

// ── Provider fetchers (return up to `count` results) ──────────────────────────
async function unsplashMany(query, count, alt) {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return []
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape&content_filter=high`
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map((p) => ({
      url: `${p.urls.raw}&w=1200&h=675&fit=crop&q=80`,
      alt: p.alt_description || alt,
      credit: { author: p.user?.name || 'Unsplash contributor', source: 'Unsplash', link: p.links?.html || 'https://unsplash.com' },
    }))
  } catch {
    return []
  }
}

async function pexelsMany(query, count, alt) {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`
    const res = await fetch(url, { headers: { Authorization: key } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.photos || []).map((p) => ({
      url: p.src?.large2x || p.src?.large || p.src?.original,
      alt: p.alt || alt,
      credit: { author: p.photographer || 'Pexels contributor', source: 'Pexels', link: p.url || 'https://pexels.com' },
    }))
  } catch {
    return []
  }
}

async function wikimediaMany(query, count, alt) {
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + query)}&gsrlimit=${count}&gsrnamespace=6` +
      `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200`
    const res = await fetch(url, { headers: { 'User-Agent': 'GreenLeafBlog/0.1 (wellness blog)' } })
    if (!res.ok) return []
    const data = await res.json()
    const pages = data?.query?.pages
    if (!pages) return []
    return Object.values(pages)
      .map((page) => {
        const info = page?.imageinfo?.[0]
        if (!info?.thumburl) return null
        const meta = info.extmetadata || {}
        const artist = (meta.Artist?.value || 'Wikimedia contributor').replace(/<[^>]+>/g, '').trim()
        return { url: info.thumburl, alt, credit: { author: artist, source: 'Wikimedia Commons', link: info.descriptionurl || info.url } }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Hero image (single). Falls back all the way to a local SVG so a post always
 * has a hero even with no network/keys.
 */
export async function sourceImage({ query, category, alt }) {
  let many = await unsplashMany(query, 1, alt)
  if (!many.length) many = await pexelsMany(query, 1, alt)
  if (!many.length) many = await wikimediaMany(query, 1, alt)
  const pick = many[0]
  if (pick) return { heroImage: pick.url, heroAlt: pick.alt, imageCredit: pick.credit, aiImage: false }
  // keyless topical remote hero, then local SVG as the very last resort
  const lf = loremflickrImage(`${query},${category}`, 7, alt)
  if (lf) return { heroImage: lf.url, heroAlt: lf.alt, imageCredit: lf.credit, aiImage: false }
  return svgFallback(category, alt)
}

/**
 * Several inline images (remote URLs). Uses whatever provider is available;
 * with no API key it returns topical LoremFlickr hotlinks so articles still
 * get real photos "from the net" without downloading anything.
 */
export async function sourceInlineImages({ query, category, count = 3, alt = '' }) {
  let imgs = await unsplashMany(query, count, alt || query)
  if (imgs.length < count) imgs = imgs.concat(await pexelsMany(query, count - imgs.length, alt || query))
  if (imgs.length < count) imgs = imgs.concat(await wikimediaMany(query, count - imgs.length, alt || query))
  // Top up with keyless topical images so we always reach `count`.
  let seed = 11
  const terms = `${query},${category}`
  while (imgs.length < count) imgs.push(loremflickrImage(terms, seed++, alt || query))
  return imgs.slice(0, count)
}

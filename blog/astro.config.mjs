import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'

// IMPORTANT: set this to the real domain the blog is served from.
// It drives canonical URLs, the sitemap, RSS, and Open Graph tags.
// If the blog lives under a path (e.g. greenleaf.app/blog), set `base` too.
const SITE = process.env.SITE_URL || 'https://greenleaf.vercel.app'

// The blog is mounted under /blog so it can live on the SAME domain as the app.
// Override with BASE_PATH=/ to run it as a standalone site at the root instead.
const BASE = process.env.BASE_PATH || '/blog'

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    mdx(),
    sitemap({
      // Astro auto-splits the sitemap into ~45k-URL chunks with an index,
      // so this scales cleanly to thousands of pages.
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
  build: {
    // Emit clean URLs: /blog/my-post/ instead of /blog/my-post.html
    format: 'directory',
  },
})

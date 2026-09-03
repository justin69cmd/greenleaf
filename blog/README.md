# 🍃 GreenLeaf Journal — the blog engine

An [Astro](https://astro.build) content site that scales to **thousands** of
wellness articles, organized into categories ("parts") with pagination, real
reference links, licensed/AI hero images, and full SEO (sitemap index, RSS,
Open Graph, JSON-LD `Article` schema).

It lives alongside the GreenLeaf/Equilibrium app as its own deployable site.

## Quickstart

```bash
cd blog
npm install
npm run dev          # http://localhost:4321
npm run build        # static output in dist/
npm run preview      # preview the built site
```

Five example posts ship in `src/content/blog/`, so the site renders immediately.

## How it's organized

```
blog/
├── astro.config.mjs         # site URL, sitemap, MDX, clean URLs
├── src/
│   ├── consts.ts            # site title, categories ("parts"), page size
│   ├── content.config.ts    # the post schema (frontmatter fields)
│   ├── content/blog/        # the posts — one .mdx file per article
│   ├── layouts/             # BaseLayout (SEO head) + BlogPost
│   ├── components/          # Header, Footer, PostCard, References, Pagination
│   └── pages/
│       ├── index.astro                       # home
│       ├── articles/[...page].astro          # all posts, paginated → /articles/, /articles/2/
│       ├── blog/[...id].astro                # a post → /blog/<slug>/
│       ├── categories/[category]/[...page].astro  # a category, paginated
│       └── rss.xml.js                        # RSS feed
├── public/heroes/           # fallback SVG hero images (always safe to ship)
└── scripts/                 # the content-generation pipeline (see below)
```

Each post is an `.mdx` file. The frontmatter fields are defined and validated in
`src/content.config.ts` — `title`, `description`, `pubDate`, `category`, `tags`,
`heroImage`, `imageCredit`, `references`, and so on. Add a category by editing
`CATEGORIES` in `src/consts.ts`.

## Generating articles at scale

The pipeline reuses your app's **free NVIDIA NIM** LLM and pulls **real reference
links** from the web for every post. Set up once:

```bash
cp .env.example .env
# add NVIDIA_API_KEY (free at https://build.nvidia.com)
# optional: UNSPLASH_ACCESS_KEY and/or PEXELS_API_KEY for real photos
```

Then the loop that scales to thousands:

```bash
npm run generate:topics        # invent fresh, specific titles per category → topics.json
npm run generate               # write the next BATCH_SIZE posts (default 25)
npm run generate 50            # or a specific batch size this run
npm run generate -- --dry      # preview which topics would be written
```

- **`generate:topics`** asks the LLM for new, de-duplicated article titles for
  each category and appends them to `scripts/topics.json`. Run it a few times to
  build a backlog of hundreds or thousands of topics.
- **`generate`** takes pending topics, does a real web search for each,
  writes a grounded 700–1000 word article citing those sources, attaches a hero
  image, and saves an `.mdx` file. It **skips topics already written**, so run it
  in batches over days — respecting your LLM's free-tier rate limits — until the
  backlog is done. Every run adds to the library; nothing is overwritten.

64 starter topics are already in `scripts/topics.json`.

### A note on scale & rate limits

Generating literally thousands of good posts is a marathon, not one command:
the free LLM and keyless search endpoints have per-minute limits, and the script
paces itself (~1 post every few seconds). Plan to run `npm run generate` in
batches. Astro itself builds thousands of pages comfortably; the sitemap is
auto-split into chunks, and images are served by path (not rebuilt per post) so
build times stay reasonable.

## Images (licensed + AI)

`scripts/lib/images.mjs` sources a hero per post in this order:

1. **Unsplash** (needs `UNSPLASH_ACCESS_KEY`) — attribution rendered under the hero.
2. **Pexels** (needs `PEXELS_API_KEY`).
3. **Wikimedia Commons** (no key).
4. **Local SVG fallback** in `public/heroes/` — always safe, no licensing worry.

Every licensed image records the author + source + link in the post's
`imageCredit`, which is shown under the image and is the correct way to use these
libraries. **Please don't hotlink random images from the open web** — the stock
APIs above are free and give you the licensing and attribution you need.

For the **AI-image** half of your "mix", wire your image model into
`generateAiImage()` in `scripts/lib/images.mjs` (save a PNG under
`public/heroes/generated/` and return its path with `aiImage: true`). Posts flagged
`aiImage` show a small "AI-generated image" label. Until you wire one in, the
pipeline uses licensed stock + the SVG fallback.

Already-written posts still on a fallback hero can be upgraded once you add keys:

```bash
npm run generate:images -- --list   # see which posts use a fallback
npm run generate:images             # upgrade them to licensed photos
```

## Deploying — stitched into the app (one domain)

The blog is **mounted at `/blog`** (see `base` in `astro.config.mjs`) so it lives
on the same domain as the app in a single Vercel deploy:

- The app builds to `dist/`.
- The blog builds (with base `/blog`) and is copied to `dist/blog/`.
- Result: `yourdomain.com/` → the app, `yourdomain.com/blog/` → the Journal.

This is wired by the root `build:site` script and `vercel.json`:

```jsonc
// package.json (root)
"build:site": "npm run build && (cd blog && npm install && npm run build) && rm -rf dist/blog && cp -r blog/dist dist/blog"

// vercel.json (root)
{ "buildCommand": "npm run build:site", "outputDirectory": "dist" }
```

**One-time Vercel step:** in the app's Vercel project, either let `vercel.json`
drive the build (default) or set the Build Command to `npm run build:site`. Set
`SITE_URL` to your real domain in the project's env vars, then update the `base`
domain in `astro.config.mjs`, `public/robots.txt` (root), and submit
`…/blog/sitemap-index.xml` in Google Search Console.

**Local dev:** the app (`npm run dev`, :5173) and the blog (`cd blog && npm run
dev`, :4321) run as separate servers, so the in-app "Journal" link resolves only
in the deployed build. To preview the stitched result locally, run `npm run
build:site` then serve `dist/`.

### Prefer two separate deploys instead?

Set `BASE_PATH=/` when building the blog and deploy `blog/` as its own Vercel
project (Root Directory = `blog`), then point a subdomain like
`blog.yourdomain.com` at it. Everything still works; only the base path changes.

> Because the blog is fully static, it's fast and cheap, and it can't take your
> app's WebSocket backend down with it.

## Content disclaimer

These are wellness articles for a general audience, not medical advice. The
templates include that reminder; keep it. Avoid clinical claims and fabricated
statistics — the pipeline is set up to ground posts in real, cited sources.

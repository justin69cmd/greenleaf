# Stitch update — blog integrated into the app

Unzip this at the **root of your `equilibrium4` project**. It overwrites/adds a
handful of files so the GreenLeaf Journal blog is served on the same domain as
the app at `/blog`, with a link into it from the app.

## What's in here

| File | Change |
|------|--------|
| `blog/` | The blog, now **base-aware** (mounted at `/blog`). Replaces the previous `blog/` folder. |
| `src/App.tsx` | Adds a **"Journal"** item to the circular nav and a **"Read the Journal"** button on the hero, both linking to `/blog/`. |
| `package.json` (root) | Adds the `build:site` script that builds the app + blog into one `dist/`. Nothing else changed. |
| `vercel.json` (root) | Tells Vercel to run `build:site` and serve `dist/`. New file. |
| `public/robots.txt` (root) | Points crawlers at the blog sitemap. If you already have one, merge the `Sitemap:` line instead of overwriting. |

Your existing `blog/greenleaf-blog-bundle.zip` backup can be deleted.

## Apply it

```bash
cd equilibrium4
# (unzip this bundle here, overwriting when asked)
npm install                 # app deps (unchanged)
cd blog && npm install      # blog deps
cd ..
npm run build:site          # builds app + blog into dist/
npx serve dist              # preview the stitched site: / = app, /blog = Journal
```

## Deploy (Vercel)

Your app's Vercel project will pick up `vercel.json` automatically. Just set
`SITE_URL` to your real domain in the project's Environment Variables, and update
the domain in `blog/astro.config.mjs` and `public/robots.txt`. Then submit
`https://<your-domain>/blog/sitemap-index.xml` in Google Search Console.

## Note on local dev

In dev the app (:5173) and blog (:4321) run separately, so the in-app `/blog/`
link only resolves in the built/deployed site. Run `npm run build:site` and serve
`dist/` to see them stitched locally.

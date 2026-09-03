import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

// Astro 5 Content Layer: load every .mdx/.md file under src/content/blog.
// The glob loader scales to thousands of entries far better than the old
// file-per-import collections.
const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/blog' }),
  schema: () =>
    z.object({
      title: z.string().max(120),
      description: z.string().max(300),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      // "into parts": every post belongs to one category (a "part") and
      // carries free-form tags for cross-linking.
      category: z.string(),
      tags: z.array(z.string()).default([]),
      // Hero image as a plain path or URL: either a file in public/
      // (e.g. /heroes/sleep.svg) or a remote licensed/AI image URL. Kept out
      // of Astro's asset pipeline so builds stay fast across thousands of posts.
      heroImage: z.string().optional(),
      heroAlt: z.string().default(''),
      // Attribution for licensed/stock images — rendered under the hero.
      imageCredit: z
        .object({
          author: z.string(),
          source: z.string(),
          link: z.string().url(),
        })
        .optional(),
      // Whether the hero was AI-generated (shown as a small label).
      aiImage: z.boolean().default(false),
      // References with links "from the net" — rendered as a sources list
      // and emitted into JSON-LD citations.
      references: z
        .array(
          z.object({
            title: z.string(),
            url: z.string().url(),
            publisher: z.string().optional(),
          }),
        )
        .default([]),
      author: z.string().default('GreenLeaf Editorial'),
      draft: z.boolean().default(false),
      readingTime: z.number().optional(),
    }),
})

export const collections = { blog }

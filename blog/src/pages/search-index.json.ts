import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { sortPosts, plainText } from '../utils'
import { withBase } from '../base'

// A static search index, built once at build time and filtered in the browser.
// The blog is a static site with no backend, and a few hundred KB of JSON beats
// shipping a search service — or a client-side index library — for a corpus
// this size.
export const GET: APIRoute = async () => {
  const posts = sortPosts(await getCollection('blog'))

  const index = posts.map((post) => ({
    title: post.data.title,
    description: post.data.description,
    category: post.data.category,
    tags: post.data.tags,
    url: withBase(`/${post.id}/`),
    date: post.data.pubDate.toISOString(),
    readingTime: post.data.readingTime ?? 1,
    // Enough body text to make search useful without bloating the payload.
    body: plainText(post.body, 900),
  }))

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

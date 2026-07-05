import { X } from 'lucide-react'

const TIPS: { emoji: string; title: string; text: string }[] = [
  {
    emoji: '🌅',
    title: 'Start with light',
    text: 'Ten minutes of morning sunlight anchors your body clock — better sleep tonight starts at sunrise.',
  },
  {
    emoji: '📝',
    title: 'The two-minute rule',
    text: 'If a task takes under two minutes, do it now. Small wins clear the fog around the big ones.',
  },
  {
    emoji: '🧘',
    title: 'Focus in cycles',
    text: 'Work in ~90-minute deep-focus blocks with 5-minute resets. Your brain is a sprinter, not a marathoner.',
  },
  {
    emoji: '💧',
    title: 'Water before coffee',
    text: 'A glass of water first thing rehydrates a night of sleep before caffeine narrows your focus.',
  },
  {
    emoji: '🌙',
    title: 'Shutdown ritual',
    text: "Write tomorrow's top three tasks before closing the laptop — your evening stays yours.",
  },
  {
    emoji: '🍃',
    title: 'One task at a time',
    text: 'Multitasking is really task-switching, and each switch taxes you. Single-tasking is a superpower.',
  },
]

export default function NewsView({ onClose }: { onClose: () => void }) {
  return (
    <div className="menu-overlay fixed inset-0 z-[9500] overflow-y-auto bg-black px-4 py-16">
      <button
        onClick={onClose}
        aria-label="Close news"
        className="fixed right-5 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="mx-auto max-w-4xl">
        <h2 className="font-classy text-center text-4xl italic text-neutral-100">
          The GreenLeaf Journal
        </h2>
        <p className="mt-2 text-center text-sm text-neutral-400">
          Small habits, calmer days — field notes from your planner.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TIPS.map((tip, i) => (
            <article
              key={tip.title}
              className="answer-reveal rounded-2xl border border-white/10 bg-gradient-to-br from-neutral-900 to-neutral-950 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/40 hover:shadow-[0_0_24px_rgba(16,185,129,0.15)]"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="text-3xl">{tip.emoji}</div>
              <h3 className="font-classy mt-3 text-lg italic text-emerald-100">{tip.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{tip.text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

import { X, Github, Instagram, Linkedin } from 'lucide-react'
import type { CSSProperties } from 'react'

interface TeamMember {
  name: string
  tagline: string
  role: string
  quote: string
  image: string
  /** object-position for the avatar crop — where the face sits in the photo. */
  focus?: string
  /** Show the photo in full color (placeholders stay grayscale). */
  color?: boolean
}

const TEAM: TeamMember[] = [
  {
    name: 'Justin',
    tagline: 'The Crazy coder',
    role: 'Founder & Planner-in-Chief',
    quote:
      'I built GreenLeaf to turn scattered intentions into a calm daily rhythm — one task at a time.',
    image: '/team/justin.jpg', // landscape photo served from public/team/
    focus: '62% 22%',
    color: true,
  },
  {
    name: 'Anushka',
    tagline: 'The Psycho designer',
    role: 'Head of Product',
    quote: 'Great planning should feel effortless. We sweat the details so your day just flows.',
    image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80',
  },
]

// The X (formerly Twitter) logo — lucide doesn't ship a brand "X" mark.
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}

const SOCIALS: {
  label: string
  href: string
  Icon: React.ComponentType<{ className?: string }>
  color: string
  glow: string
}[] = [
  { label: 'GitHub', href: '#', Icon: Github, color: '#ffffff', glow: 'rgba(255,255,255,0.55)' },
  { label: 'Instagram', href: '#', Icon: Instagram, color: '#e1306c', glow: 'rgba(225,48,108,0.65)' },
  { label: 'X', href: '#', Icon: XIcon, color: '#ffffff', glow: 'rgba(125,170,255,0.6)' },
  { label: 'LinkedIn', href: '#', Icon: Linkedin, color: '#3b9dff', glow: 'rgba(10,102,194,0.7)' },
]

function SocialRow() {
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      {SOCIALS.map(({ label, href, Icon, color, glow }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="social-btn flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-neutral-900"
          style={{ color, '--glow': glow } as CSSProperties}
        >
          <Icon className="h-4 w-4" />
        </a>
      ))}
    </div>
  )
}

function MemberCard({ member, tilt }: { member: TeamMember; tilt: string }) {
  return (
    <article
      className={`profile-card relative w-[280px] max-w-[80vw] overflow-hidden rounded-3xl p-7 pb-8 transition-transform duration-300 hover:rotate-0 hover:scale-[1.02] ${tilt}`}
      style={{ background: 'linear-gradient(150deg, #161616 0%, #0a0a0a 100%)' }}
    >
      <div className="mx-auto mt-2 h-32 w-32 overflow-hidden rounded-full shadow-md ring-4 ring-emerald-400/30">
        <img
          src={member.image}
          alt={member.name}
          className={
            member.color
              ? 'h-full w-full object-cover contrast-[1.03] saturate-[1.08]'
              : 'h-full w-full object-cover grayscale contrast-[1.05]'
          }
          style={member.focus ? { objectPosition: member.focus } : undefined}
        />
      </div>

      <blockquote className="mt-6 text-center text-[13px] italic leading-relaxed text-neutral-400">
        “{member.quote}”
      </blockquote>

      <p className="font-classy mt-5 text-center text-2xl italic text-emerald-50">{member.name}</p>
      <p className="font-classy mt-1 text-center text-sm italic text-emerald-300/90">
        {member.tagline}
      </p>

      <SocialRow />
    </article>
  )
}

export default function TeamShowcase({ onClose }: { onClose: () => void }) {
  return (
    <div className="menu-overlay fixed inset-0 z-[9500] flex flex-col items-center justify-center bg-black px-4">
      <button
        onClick={onClose}
        aria-label="Close team"
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <h2 className="font-classy mb-10 text-4xl italic text-neutral-100">Our Team</h2>

      <div className="flex flex-wrap items-center justify-center gap-8">
        <MemberCard member={TEAM[0]} tilt="-rotate-3" />
        <MemberCard member={TEAM[1]} tilt="rotate-3" />
      </div>
    </div>
  )
}

# Appendix — GreenLeaf (Equilibrium) Source Code

Complete listing of the active source files. **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS.
**Backend:** Node.js (Express + WebSocket), multi-agent swarm on the NVIDIA NIM LLM API.

| Layer | Files |
|---|---|
| Frontend shell | `src/main.tsx`, `src/App.tsx`, `src/index.css` |
| UI components | `src/components/ui/*.tsx` |
| Backend server | `server/index.ts`, `server/auth.ts`, `server/types.ts` |
| Agent swarm | `server/agent/*.ts` |


---

## `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

```

---

## `src/App.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Home, FileText, Users, Search, Settings, Menu } from 'lucide-react'
import { SplineScene } from '@/components/ui/splite'
import { Card } from '@/components/ui/card'
import { Spotlight } from '@/components/ui/spotlight'
import CircularNavigation from '@/components/ui/circular-navigation-bar'
import TeamShowcase from '@/components/ui/team-showcase'
import GetStartedModal, { type AuthUser } from '@/components/ui/get-started-modal'
import AIModelView from '@/components/ui/ai-model-view'
import NewsView from '@/components/ui/news-view'
import SettingsPanel from '@/components/ui/settings-panel'

function loadUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem('greenleaf-user') || 'null')
  } catch {
    return null
  }
}

const navItems = [
  { name: 'Home', icon: Home, href: '#' },
  { name: 'News', icon: FileText, href: '#' },
  { name: 'Team', icon: Users, href: '#' },
  { name: 'Search', icon: Search, href: '#' },
  { name: 'Settings', icon: Settings, href: '#' },
]

export default function App() {
  const [isOpen, setIsOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(loadUser)
  // Restore the AI view across refreshes so an accidental F5 doesn't dump a
  // signed-in user back on the landing page mid-conversation.
  const [view, setView] = useState<'home' | 'team' | 'ai' | 'news'>(() =>
    localStorage.getItem('greenleaf-view') === 'ai' && loadUser() ? 'ai' : 'home'
  )
  const [showAuth, setShowAuth] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const toggleMenu = () => setIsOpen((v) => !v)
  const handleSelect = (name: string) => {
    if (name === 'Team') setView('team')
    if (name === 'Home') setView('home')
    if (name === 'News') setView('news')
    if (name === 'Settings') setShowSettings(true)
  }

  const signOut = () => {
    localStorage.removeItem('greenleaf-user')
    localStorage.removeItem('greenleaf-chat')
    localStorage.removeItem('greenleaf-view')
    setUser(null)
    setShowSettings(false)
    setView('home')
  }

  useEffect(() => {
    localStorage.setItem('greenleaf-view', view)
  }, [view])

  const handleGetStarted = () => {
    if (user) setView('ai') // already signed in — straight to the planner
    else setShowAuth(true)
  }

  return (
    <div className="relative min-h-screen w-full bg-black flex items-center justify-center p-4 sm:p-8">
      {/* Top-left menu trigger */}
      <button
        onClick={toggleMenu}
        aria-label="Open navigation"
        className="fixed top-5 left-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Card className="w-full max-w-5xl h-[500px] bg-black/[0.96] relative overflow-hidden">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="white" />

        <div className="flex h-full">
          {/* Left content */}
          <div className="flex-1 p-8 relative z-10 flex flex-col justify-center">
            <h1 className="font-classy italic text-5xl md:text-6xl font-semibold bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400">
              GreenLeaf
            </h1>
            <p className="mt-4 text-lg text-neutral-200 max-w-lg">Your planner at service.</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-400">
              Plan your days, track your goals, and grow one task at a time. GreenLeaf turns
              scattered to-dos into a calm, organized routine — so you spend less time managing your
              list and more time living it.
            </p>
            <button
              onClick={handleGetStarted}
              className="glow-border mt-6 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-400/15 px-5 py-2.5 text-sm font-medium text-emerald-50 backdrop-blur-md transition-colors hover:border-emerald-200/90 hover:bg-emerald-400/25"
            >
              Get started
              <span aria-hidden>→</span>
            </button>
          </div>

          {/* Right content */}
          <div className="flex-1 relative">
            <SplineScene
              scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
              className="w-full h-full"
            />
          </div>
        </div>
      </Card>

      <CircularNavigation
        navItems={navItems}
        isOpen={isOpen}
        toggleMenu={toggleMenu}
        onSelect={handleSelect}
      />

      {view === 'team' && <TeamShowcase onClose={() => setView('home')} />}

      {view === 'ai' && <AIModelView onClose={() => setView('home')} userName={user?.name} />}

      {view === 'news' && <NewsView onClose={() => setView('home')} />}

      {showSettings && (
        <SettingsPanel user={user} onClose={() => setShowSettings(false)} onSignOut={signOut} />
      )}

      {showAuth && (
        <GetStartedModal
          onClose={() => setShowAuth(false)}
          onSuccess={(u) => {
            setUser(u)
            localStorage.setItem('greenleaf-user', JSON.stringify(u))
            setShowAuth(false)
            setView('ai')
          }}
        />
      )}
    </div>
  )
}

```

---

## `src/lib/utils.ts`

```tsx
// Minimal `cn` helper (shadcn components import this from "@/lib/utils").
// We don't pull in clsx/tailwind-merge — for this project a truthy join is enough.
export type ClassValue = string | number | null | false | undefined

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ')
}

```

---

## `src/components/ui/splite.tsx`

```tsx
import { Suspense, lazy, Component, useRef, useState, type ReactNode } from 'react'

const Spline = lazy(() => import('@splinetool/react-spline'))

// Shown when the 3D scene errors out, or layered on top while it's still
// loading past the timeout — slow venue Wi-Fi shouldn't mean a spinner hero.
function HeroFallback() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: 'radial-gradient(circle at 60% 40%, #0c2018 0%, #05100b 60%, #000 100%)',
      }}
    >
      <span
        aria-hidden
        className="float-emerald text-[110px] leading-none drop-shadow-[0_0_45px_rgba(16,185,129,0.5)]"
      >
        🍃
      </span>
    </div>
  )
}

class SplineErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

interface SplineSceneProps {
  scene: string
  className?: string
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const timerRef = useRef<number | null>(null)

  // Arm the timeout once, on first render.
  if (timerRef.current === null) {
    timerRef.current = window.setTimeout(() => setTimedOut(true), 8000)
  }

  return (
    <SplineErrorBoundary fallback={<HeroFallback />}>
      <div className="relative h-full w-full">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <span className="loader"></span>
            </div>
          }
        >
          <Spline
            scene={scene}
            className={className}
            onLoad={() => {
              if (timerRef.current !== null) clearTimeout(timerRef.current)
              setLoaded(true)
            }}
          />
        </Suspense>
        {/* Keep loading underneath; the fallback lifts as soon as the scene lands. */}
        {timedOut && !loaded && (
          <div className="absolute inset-0">
            <HeroFallback />
          </div>
        )}
      </div>
    </SplineErrorBoundary>
  )
}

```

---

## `src/components/ui/circular-navigation-bar.tsx`

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'

interface NavItem {
  name: string
  icon: React.ComponentType<{ className?: string }>
  href: string
}

interface CircularNavigationProps {
  navItems: NavItem[]
  isOpen: boolean
  toggleMenu: () => void
  onSelect?: (name: string) => void
}

export default function CircularNavigation({
  navItems,
  isOpen,
  toggleMenu,
  onSelect,
}: CircularNavigationProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  if (!isOpen) return null

  return (
    <div
      className="menu-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/80"
      onClick={toggleMenu}
    >
      <div
        className="menu-circle relative flex aspect-square w-[420px] max-w-[90vw] items-center justify-center rounded-full"
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow:
            'inset 2px 2px 2px rgba(255,255,255,0.5), inset -1px -1px 1px rgba(255,255,255,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={toggleMenu}
          aria-label="Close navigation"
          className="absolute z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-black"
        >
          <X className="h-6 w-6" />
        </button>

        {navItems.map((item, index) => {
          const Icon = item.icon
          const angle = (360 / navItems.length) * index

          return (
            <div
              key={item.name}
              className="absolute"
              style={{
                transform: `rotate(${angle}deg) translate(150px) rotate(-${angle}deg)`,
              }}
            >
              <a
                href={item.href}
                className={`flex h-20 w-20 flex-col items-center justify-center rounded-full no-underline transition-colors duration-200 ${
                  hoveredItem === item.name ? 'bg-white text-black' : 'text-white'
                }`}
                onMouseEnter={() => setHoveredItem(item.name)}
                onMouseLeave={() => setHoveredItem(null)}
                onClick={(e) => {
                  e.preventDefault()
                  onSelect?.(item.name)
                  toggleMenu()
                }}
              >
                <Icon className="mb-1 h-6 w-6" />
                <span className="text-xs font-medium">{item.name}</span>
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

```

---

## `src/components/ui/team-showcase.tsx`

```tsx
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

```

---

## `src/components/ui/get-started-modal.tsx`

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'

type Mode = 'login' | 'signup'

export interface AuthUser {
  name: string
  email: string
  token: string
}

const API = 'http://localhost:4000'

export default function GetStartedModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess?: (user: AuthUser) => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [doneUser, setDoneUser] = useState<AuthUser | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || loading) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/auth/${mode === 'login' ? 'login' : 'signup'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { name, email, password }),
      })
      const data = (await res.json()) as AuthUser & { error?: string }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      setDoneUser(data)
      setTimeout(() => (onSuccess ? onSuccess(data) : onClose()), 1100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('fetch') ? 'Could not reach the server — is it running?' : msg)
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-emerald-400/60'

  return (
    <div
      className="menu-overlay fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-neutral-950/90 p-7 shadow-2xl"
        style={{ boxShadow: '0 0 30px rgba(16,185,129,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {doneUser ? (
          <div className="py-8 text-center">
            <div className="mb-3 text-3xl">🌿</div>
            <p className="font-medium text-white">
              {mode === 'login'
                ? `Welcome back, ${doneUser.name.split(' ')[0]}!`
                : `Welcome to GreenLeaf, ${doneUser.name.split(' ')[0]}!`}
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-classy text-2xl italic text-white">
              {mode === 'login' ? 'Welcome back' : 'Join GreenLeaf'}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {mode === 'login' ? 'Sign in to your planner.' : 'Create your free account.'}
            </p>

            <form onSubmit={submit} className="mt-5 space-y-3">
              {mode === 'signup' && (
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              )}
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />

              {error && <p className="text-sm text-red-400/90">{error}</p>}

              <button
                type="submit"
                disabled={!email || !password || loading}
                className="glow-border w-full rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-sm font-medium text-emerald-50 backdrop-blur-md transition-colors hover:bg-emerald-400/25 disabled:opacity-40"
              >
                {loading ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-neutral-400">
              {mode === 'login' ? 'New here? ' : 'Already have an account? '}
              <button
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login')
                  setError('')
                }}
                className="font-medium text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
              >
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

```

---

## `src/components/ui/ai-model-view.tsx`

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X, Paperclip, ArrowUp, Mic, RotateCcw, FileText, Copy, Check } from 'lucide-react'

const CHIPS = ['Plan my week', 'Set a goal', 'Daily routine', 'Brain dump']
const FOLLOWUP_CHIPS = ['Refine this plan', 'Make it shorter', 'What should I do first?']
const WS_URL = 'ws://localhost:4000'
const API = 'http://localhost:4000'
const CHAT_KEY = 'greenleaf-chat'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  files?: string[]
}

function loadChat(): Msg[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Web Speech API (Chrome/Edge; absent elsewhere — the mic button hides itself).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
const SpeechRec: (new () => SpeechRecognitionLike) | undefined =
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition ??
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition

interface TaskInfo {
  id: string
  description: string
  role?: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

const ROLE_META: Record<string, { icon: string; label: string }> = {
  researcher: { icon: '🔍', label: 'Researcher' },
  writer: { icon: '✍️', label: 'Writer' },
  analyst: { icon: '📊', label: 'Analyst' },
  generalist: { icon: '🤖', label: 'Agent' },
}

interface LeafParticle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  size: number
  sway: number
  swaySpeed: number
  sprite: number
  depth: number
}

// Pre-render a leaf into an offscreen canvas (blade gradient + midrib + veins).
function makeLeafSprite(c1: string, c2: string, c3: string): HTMLCanvasElement {
  const S = 64
  const cnv = document.createElement('canvas')
  cnv.width = S
  cnv.height = S
  const g = cnv.getContext('2d')!
  g.translate(S / 2, S / 2)

  const grad = g.createLinearGradient(-12, -26, 12, 26)
  grad.addColorStop(0, c1)
  grad.addColorStop(0.5, c2)
  grad.addColorStop(1, c3)
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, -26)
  g.bezierCurveTo(-14, -14, -16, 12, 0, 26)
  g.bezierCurveTo(16, 12, 14, -14, 0, -26)
  g.closePath()
  g.fill()

  g.strokeStyle = 'rgba(220,252,231,0.45)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, 24)
  g.lineTo(0, -24)
  g.stroke()

  g.lineWidth = 0.8
  g.beginPath()
  g.moveTo(0, 8)
  g.lineTo(-8, 0)
  g.moveTo(0, 8)
  g.lineTo(8, 0)
  g.moveTo(0, -2)
  g.lineTo(-7, -9)
  g.moveTo(0, -2)
  g.lineTo(7, -9)
  g.stroke()

  return cnv
}

/* ── Tiny markdown renderer for the synthesizer's output ──────────────────────
   The backend emits the same Markdown subset that ResultView/pdf render:
   headings (#–####), bullet & numbered lists, **bold**, and paragraphs. */
function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {p.slice(2, -2)}
        </strong>
      )
    }
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
      return (
        <code key={i} className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] text-emerald-200">
          {p.slice(1, -1)}
        </code>
      )
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return (
        <em key={i} className="text-emerald-100/90">
          {p.slice(1, -1)}
        </em>
      )
    }
    return <span key={i}>{p}</span>
  })
}

function renderRich(text: string): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []
  let ordered = false
  // Running number for ordered lists — survives blank lines and interleaved
  // sub-bullets so "1./2./3." doesn't reset to "1." at every gap.
  let olStart = 1

  const flush = () => {
    if (!list.length) return
    const items = list.map((it, i) => <li key={i}>{inline(it)}</li>)
    if (ordered) {
      blocks.push(
        <ol key={`b${blocks.length}`} start={olStart} className="ml-5 list-decimal space-y-1">
          {items}
        </ol>
      )
      olStart += list.length
    } else {
      blocks.push(
        <ul key={`b${blocks.length}`} className="ml-5 list-disc space-y-1">
          {items}
        </ul>
      )
    }
    list = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    // Blank lines don't flush — lists commonly have gaps between items.
    if (!line) continue
    // Horizontal rules render as a subtle divider, not literal dashes.
    if (/^[-*_]{3,}$/.test(line)) {
      flush()
      olStart = 1
      blocks.push(<div key={`b${blocks.length}`} className="my-1 border-t border-white/10" />)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      olStart = 1
      const big = h[1].length <= 2
      blocks.push(
        <p
          key={`b${blocks.length}`}
          className={
            big
              ? 'mt-3 text-base font-semibold text-emerald-100'
              : 'mt-2 text-sm font-semibold text-emerald-100/90'
          }
        >
          {inline(h[2])}
        </p>
      )
      continue
    }
    const ul = line.match(/^[-*+]\s+(.*)$/)
    const ol = line.match(/^\d+[.)]\s+(.*)$/)
    if (ul) {
      if (ordered) flush()
      ordered = false
      list.push(ul[1])
      continue
    }
    if (ol) {
      if (!ordered && list.length) flush()
      ordered = true
      list.push(ol[1])
      continue
    }
    flush()
    olStart = 1
    blocks.push(<p key={`b${blocks.length}`}>{inline(line)}</p>)
  }
  flush()
  return blocks
}

export default function AIModelView({
  onClose,
  userName,
}: {
  onClose: () => void
  userName?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const firstName = userName?.trim().split(' ')[0]

  // ── Chat state (persisted so a refresh doesn't wipe the conversation) ───────
  const [messages, setMessages] = useState<Msg[]>(loadChat)
  const [started, setStarted] = useState(() => loadChat().length > 0)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [listening, setListening] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const copyMessage = (i: number, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1500)
    })
  }

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)))
  }, [messages])

  const wsRef = useRef<WebSocket | null>(null)
  const convoStartedRef = useRef(false) // false → next dispatch is `start`, else `followup`
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Files the writer agent saved during the current run (from tool_result events).
  const filesRef = useRef<string[]>([])
  // Mirrors `busy` for event handlers (onclose fires outside the render cycle).
  const busyRef = useRef(false)
  const setBusySync = (v: boolean) => {
    busyRef.current = v
    setBusy(v)
  }

  const pushAssistant = (text: string, files?: string[]) =>
    setMessages((m) => [...m, { role: 'assistant', text, ...(files?.length ? { files } : {}) }])

  const newChat = () => {
    wsRef.current?.close()
    wsRef.current = null
    convoStartedRef.current = false
    localStorage.removeItem(CHAT_KEY)
    setMessages([])
    setTasks([])
    setStatus('')
    setBusySync(false)
    setStarted(false)
  }

  const toggleVoice = () => {
    if (!SpeechRec) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SpeechRec()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('')
      setInput(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  // Auto-scroll the thread as it grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, status, busy])

  // Close the socket when the view unmounts.
  useEffect(() => () => wsRef.current?.close(), [])

  const send = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return

    setMessages((m) => [...m, { role: 'user', text }])
    setStarted(true)
    setInput('')
    setBusySync(true)
    setTasks([])
    filesRef.current = []
    setStatus('Connecting…')

    const dispatch = () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (!convoStartedRef.current) {
        convoStartedRef.current = true
        ws.send(JSON.stringify({ type: 'start', goal: text, delivery: 'screen', skipClarify: true }))
      } else {
        ws.send(JSON.stringify({ type: 'followup', goal: text }))
      }
    }

    const onMessage = (ev: MessageEvent) => {
      let msg: { type: string; payload: unknown }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      const ws = wsRef.current
      switch (msg.type) {
        case 'log':
          setStatus(String(msg.payload))
          break
        case 'clarify':
          // Keep the chat single-shot — skip clarifying questions and plan.
          setStatus('Planning your steps…')
          ws?.send(JSON.stringify({ type: 'clarify', answers: [] }))
          break
        case 'plan_proposed':
          setStatus('Kicking off the plan…')
          ws?.send(JSON.stringify({ type: 'approve' }))
          break
        case 'plan': {
          const plan = (msg.payload as TaskInfo[]) ?? []
          setTasks(plan.map((t) => ({ ...t, status: 'pending' })))
          setStatus('The team is on it…')
          break
        }
        case 'task_start': {
          const t = msg.payload as TaskInfo
          setTasks((prev) => prev.map((p) => (p.id === t.id ? { ...p, status: 'running' } : p)))
          break
        }
        case 'task_done': {
          const t = msg.payload as TaskInfo
          setTasks((prev) => prev.map((p) => (p.id === t.id ? { ...p, status: 'done' } : p)))
          break
        }
        case 'tool_result': {
          // Collect files the writer saved so the answer can offer downloads.
          const p = msg.payload as { tool?: string; result?: string }
          const m = p?.tool === 'write_file' && p.result?.match(/File written to agent_workspace\/(.+)$/)
          if (m && m[1] && !filesRef.current.includes(m[1])) filesRef.current.push(m[1])
          break
        }
        case 'agent_done':
          pushAssistant((msg.payload as { summary?: string })?.summary ?? 'Done.', filesRef.current)
          setStatus('')
          setTasks([])
          setBusySync(false)
          window.dispatchEvent(new Event('leaf-burst'))
          break
        case 'agent_error':
          pushAssistant(`⚠️ ${String(msg.payload)}`)
          setStatus('')
          setTasks([])
          setBusySync(false)
          break
        default:
          break
      }
    }

    let ws = wsRef.current
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      ws = new WebSocket(WS_URL)
      wsRef.current = ws
      convoStartedRef.current = false
      ws.onmessage = onMessage
      ws.onopen = dispatch
      ws.onerror = () => {
        setStatus('')
        setTasks([])
        setBusySync(false)
        pushAssistant('⚠️ Could not reach the planner. Make sure the server is running on port 4000.')
      }
      // If the connection drops mid-run, unfreeze the input so the user can
      // retry (a fresh socket + `start` is created on the next send).
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (busyRef.current) {
          setStatus('')
          setTasks([])
          setBusySync(false)
          pushAssistant('⚠️ Lost connection to the planner. Check the server, then send your message again.')
        }
      }
    } else {
      ws.onmessage = onMessage
      if (ws.readyState === WebSocket.OPEN) dispatch()
      else ws.onopen = dispatch
    }
  }

  // ── Leaf swirl canvas ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    const mouse = { x: -9999, y: -9999, active: false }

    const sprites = [
      makeLeafSprite('#6ee7b7', '#10b981', '#047857'),
      makeLeafSprite('#a7f3d0', '#34d399', '#059669'),
      makeLeafSprite('#34d399', '#059669', '#065f46'),
    ]

    let leaves: LeafParticle[] = []

    // Celebration burst — a fan of leaves from the centre when an answer lands.
    interface BurstLeaf {
      x: number; y: number; vx: number; vy: number
      rot: number; vrot: number; size: number; sprite: number; life: number
    }
    let bursts: BurstLeaf[] = []
    const onBurst = () => {
      if (reduce) return
      const cx = w / 2
      const cy = h * 0.4
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 2.5 + Math.random() * 4.5
        bursts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1.2,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 0.3,
          size: 18 + Math.random() * 24,
          sprite: Math.floor(Math.random() * sprites.length),
          life: 1,
        })
      }
    }
    window.addEventListener('leaf-burst', onBurst)

    const seed = () => {
      const count = Math.round(Math.min(34, Math.max(16, (w * h) / 45000)))
      leaves = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.02,
        size: 24 + Math.random() * 30,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.008 + Math.random() * 0.02,
        sprite: Math.floor(Math.random() * sprites.length),
        depth: 0.5 + Math.random() * 0.5,
      }))
    }

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    const frame = () => {
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h * 0.45

      for (const l of leaves) {
        if (!reduce) {
          l.sway += l.swaySpeed
          // gentle swirl around the centre
          const sx = l.x - cx
          const sy = l.y - cy
          l.x += -sy * 0.0007 * l.depth
          l.y += sx * 0.0007 * l.depth
          // drift + breeze sway
          l.x += l.vx + Math.sin(l.sway) * 0.5
          l.y += l.vy + Math.cos(l.sway * 0.8) * 0.25 - 0.04
          l.rot += l.vrot + Math.sin(l.sway) * 0.006
          // cursor reaction — leaves get nudged away
          if (mouse.active) {
            const dx = l.x - mouse.x
            const dy = l.y - mouse.y
            const d2 = dx * dx + dy * dy
            const R = 170
            if (d2 < R * R) {
              const d = Math.sqrt(d2) || 1
              const f = ((R - d) / R) * 0.9
              l.x += (dx / d) * f
              l.y += (dy / d) * f
              l.rot += 0.01
            }
          }
          // wrap around edges
          if (l.x < -50) l.x = w + 50
          if (l.x > w + 50) l.x = -50
          if (l.y < -50) l.y = h + 50
          if (l.y > h + 50) l.y = -50
        }

        ctx.save()
        ctx.translate(l.x, l.y)
        ctx.rotate(l.rot)
        ctx.globalAlpha = 0.85
        ctx.drawImage(sprites[l.sprite], -l.size / 2, -l.size / 2, l.size, l.size)
        ctx.restore()
      }
      // Burst leaves: fly outward, drift down, fade out.
      for (const b of bursts) {
        b.x += b.vx
        b.y += b.vy
        b.vx *= 0.97
        b.vy = b.vy * 0.97 + 0.06
        b.rot += b.vrot
        b.life -= 0.011
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.globalAlpha = Math.max(0, b.life) * 0.9
        ctx.drawImage(sprites[b.sprite], -b.size / 2, -b.size / 2, b.size, b.size)
        ctx.restore()
      }
      bursts = bursts.filter((b) => b.life > 0)

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - r.left
      mouse.y = e.clientY - r.top
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = -9999
      mouse.y = -9999
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeave)
    frame()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('leaf-burst', onBurst)
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  // The chat input box, reused in both the hero and conversation layouts.
  const inputBox = (
    <div className="profile-card rounded-2xl bg-neutral-900/70 p-3 backdrop-blur-md">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        placeholder={busy ? 'Working…' : 'Ask GreenLeaf AI…'}
        className="w-full bg-transparent px-2 pb-6 pt-1 text-sm text-white placeholder-white/35 outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            aria-label="Attach"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:text-white/70"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          {SpeechRec && (
            <button
              onClick={toggleVoice}
              aria-label={listening ? 'Stop listening' : 'Speak your goal'}
              className={
                listening
                  ? 'mic-live flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/25 text-emerald-300'
                  : 'flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:text-emerald-300'
              }
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-[9500] overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 45%, #0c2018 0%, #05100b 55%, #020604 100%)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {started && (
        <button
          onClick={newChat}
          aria-label="Start a new chat"
          title="New chat"
          className="absolute left-5 top-5 z-20 flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-sm text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
        >
          <RotateCcw className="h-4 w-4" />
          New chat
        </button>
      )}

      {!started ? (
        /* ── Hero: centred prompt before the first message ── */
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
          <h2 className="ai-fade-up text-center text-3xl font-semibold text-emerald-50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] sm:text-4xl">
            {firstName ? (
              <>
                What can I help you plan,{' '}
                <span className="font-classy italic text-emerald-300">{firstName}</span>?
              </>
            ) : (
              'What can I help you plan?'
            )}
          </h2>

          <div className="ai-fade-up mt-7 w-full max-w-xl" style={{ animationDelay: '0.5s' }}>
            {inputBox}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => send(c)}
                  className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:border-emerald-400/40 hover:text-white"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── Conversation: thread + pinned input ── */
        <div className="relative z-10 flex h-full flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-20 pb-4">
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="self-end max-w-[85%]">
                    <div className="rounded-2xl rounded-br-md bg-emerald-500/90 px-4 py-2.5 text-sm text-black">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="answer-reveal group self-start max-w-[92%]">
                    <div className="profile-card relative space-y-2 rounded-2xl rounded-bl-md bg-neutral-900/75 px-4 py-3 text-sm leading-relaxed text-neutral-100 backdrop-blur-md">
                      <button
                        onClick={() => copyMessage(i, m.text)}
                        aria-label="Copy answer"
                        title="Copy answer"
                        className="absolute right-2.5 top-2.5 rounded-md p-1 text-white/25 opacity-0 transition-all hover:bg-white/10 hover:text-emerald-300 group-hover:opacity-100"
                      >
                        {copiedIdx === i ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {(renderRich(m.text) as ReactNode[]).map((block, bi) => (
                        <div
                          key={bi}
                          className="block-reveal"
                          style={{ animationDelay: `${Math.min(bi * 70, 900)}ms` }}
                        >
                          {block}
                        </div>
                      ))}
                      {m.files && m.files.length > 0 && (
                        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                          {m.files.map((f) => (
                            <a
                              key={f}
                              href={`${API}/files/${f.split('/').map(encodeURIComponent).join('/')}`}
                              download
                              className="flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200 transition-colors hover:bg-emerald-400/20"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {f}
                              <span aria-hidden>⬇</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}

              {/* Contextual follow-ups once an answer is on screen */}
              {!busy && messages.length > 0 && messages[messages.length - 1].role === 'assistant' &&
                !messages[messages.length - 1].text.startsWith('⚠️') && (
                  <div className="answer-reveal flex flex-wrap gap-2 self-start" style={{ animationDelay: '0.9s' }}>
                    {FOLLOWUP_CHIPS.map((c) => (
                      <button
                        key={c}
                        onClick={() => send(c)}
                        className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/60 transition-colors hover:border-emerald-400/40 hover:text-white"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

              {busy && (
                <div className="answer-reveal self-start w-full max-w-[92%]">
                  <div className="rounded-2xl rounded-bl-md border border-emerald-400/25 bg-neutral-900/65 px-4 py-3 backdrop-blur-md">
                    {tasks.length > 0 && (
                      <div className="mb-3 space-y-2 border-b border-white/5 pb-3">
                        {tasks.map((t) => {
                          const meta = ROLE_META[t.role ?? 'generalist'] ?? ROLE_META.generalist
                          return (
                            <div key={t.id} className="flex items-center gap-2.5 text-sm">
                              <span className="w-5 text-center">{meta.icon}</span>
                              <span
                                className={
                                  t.status === 'done'
                                    ? 'flex-1 truncate text-emerald-200/50 line-through decoration-emerald-200/25'
                                    : t.status === 'running'
                                      ? 'flex-1 truncate text-white'
                                      : 'flex-1 truncate text-white/40'
                                }
                              >
                                <span className="mr-1.5 text-[11px] uppercase tracking-wide text-emerald-300/70">
                                  {meta.label}
                                </span>
                                {t.description}
                              </span>
                              {t.status === 'done' ? (
                                <span className="text-emerald-400">✓</span>
                              ) : t.status === 'running' ? (
                                <span className="task-dot-running inline-block h-2 w-2 rounded-full bg-emerald-400" />
                              ) : (
                                <span className="inline-block h-2 w-2 rounded-full bg-white/15" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="leaf-pulse">🌿</span>
                      <span className="status-shimmer font-medium">{status || 'Thinking…'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-8">
            <div className="mx-auto w-full max-w-2xl">{inputBox}</div>
          </div>
        </div>
      )}
    </div>
  )
}

```

---

## `src/components/ui/news-view.tsx`

```tsx
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

```

---

## `src/components/ui/settings-panel.tsx`

```tsx
import { X, LogOut, Trash2 } from 'lucide-react'
import type { AuthUser } from './get-started-modal'

export default function SettingsPanel({
  user,
  onClose,
  onSignOut,
}: {
  user: AuthUser | null
  onClose: () => void
  onSignOut: () => void
}) {
  const clearChat = () => {
    localStorage.removeItem('greenleaf-chat')
    onClose()
  }

  return (
    <div
      className="menu-overlay fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-emerald-400/30 bg-neutral-950/90 p-7 shadow-2xl"
        style={{ boxShadow: '0 0 30px rgba(16,185,129,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="font-classy text-2xl italic text-white">Settings</h2>

        {user ? (
          <>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{user.email}</p>
            </div>

            <div className="mt-4 space-y-2">
              <button
                onClick={clearChat}
                className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-300 transition-colors hover:border-white/25 hover:text-white"
              >
                <Trash2 className="h-4 w-4" />
                Clear chat history
              </button>
              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-2.5 rounded-xl border border-red-400/25 bg-red-400/5 px-4 py-2.5 text-sm text-red-300/90 transition-colors hover:border-red-400/50 hover:text-red-200"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        ) : (
          <p className="mt-5 text-sm text-neutral-400">
            You're not signed in yet — hit <span className="text-emerald-300">Get started</span> on
            the home page to create your planner.
          </p>
        )}
      </div>
    </div>
  )
}

```

---

## `src/index.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600;1,700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Elegant serif for classy headings. */
.font-classy {
  font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
}

/* Circular navigation entrance (CSS-driven so it always plays). */
@keyframes menu-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes menu-scale {
  from {
    opacity: 0;
    transform: scale(0);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.menu-overlay {
  animation: menu-fade 0.3s ease both;
}
.menu-circle {
  animation: menu-scale 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* Dark team profile card with an emerald border glow. */
.profile-card {
  border: 1px solid rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 18px rgba(16, 185, 129, 0.25), 0 0 44px rgba(16, 185, 129, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* Circular social buttons that glow in their brand color on hover.
   The glow color is passed per-button via the --glow custom property. */
.social-btn {
  transition: box-shadow 0.25s ease, transform 0.25s ease, background-color 0.25s ease;
}
.social-btn:hover {
  transform: scale(1.12);
  background-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 14px var(--glow), 0 0 30px var(--glow);
}

/* AI model reveal: zoom out into a gently floating emerald. */
@keyframes ai-zoom-out {
  from {
    transform: scale(2.5);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.ai-zoom {
  animation: ai-zoom-out 1.3s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes float-emerald {
  0%,
  100% {
    transform: translateY(-9px);
  }
  50% {
    transform: translateY(9px);
  }
}
.float-emerald {
  animation: float-emerald 4s ease-in-out infinite;
}
@keyframes ai-fade-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ai-fade-up {
  animation: ai-fade-up 0.8s ease both;
  animation-delay: 1s;
}
@media (prefers-reduced-motion: reduce) {
  .ai-zoom,
  .float-emerald,
  .ai-fade-up {
    animation: none;
    opacity: 1;
  }
}

/* Shimmering status text while the agent team works. */
@keyframes status-shimmer {
  to {
    background-position: -200% center;
  }
}
.status-shimmer {
  background: linear-gradient(
    90deg,
    rgba(167, 243, 208, 0.45) 0%,
    #6ee7b7 40%,
    #ecfdf5 50%,
    #6ee7b7 60%,
    rgba(167, 243, 208, 0.45) 100%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: status-shimmer 1.8s linear infinite;
}

/* Pulsing dot next to the task currently being executed. */
@keyframes task-pulse {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.85);
    box-shadow: 0 0 0 rgba(52, 211, 153, 0);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
    box-shadow: 0 0 8px rgba(52, 211, 153, 0.8);
  }
}
.task-dot-running {
  animation: task-pulse 1s ease-in-out infinite;
}

/* Mic button while listening — soft breathing glow. */
@keyframes mic-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.45);
  }
  50% {
    box-shadow: 0 0 0 7px rgba(52, 211, 153, 0);
  }
}
.mic-live {
  animation: mic-pulse 1.4s ease-out infinite;
}

/* Answer paragraphs cascade in one after another. */
@keyframes block-reveal {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.block-reveal {
  animation: block-reveal 0.5s ease both;
}

/* Chat cards slide in as they appear. */
@keyframes answer-reveal {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.answer-reveal {
  animation: answer-reveal 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .status-shimmer,
  .task-dot-running,
  .answer-reveal,
  .block-reveal,
  .mic-live {
    animation: none;
  }
  .status-shimmer {
    color: #a7f3d0;
    -webkit-text-fill-color: #a7f3d0;
  }
}

/* Gently pulsing leaf used as the "thinking" indicator in the AI chat. */
@keyframes leaf-pulse {
  0%,
  100% {
    transform: scale(1) rotate(-6deg);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.18) rotate(6deg);
    opacity: 1;
  }
}
.leaf-pulse {
  display: inline-block;
  animation: leaf-pulse 1.1s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .leaf-pulse {
    animation: none;
  }
}

/* Spinner shown while the Spline 3D scene loads (SplineScene fallback). */
.loader {
  width: 42px;
  height: 42px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-bottom-color: #ffffff;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  animation: loader-rotation 1s linear infinite;
}
@keyframes loader-rotation {
  to {
    transform: rotate(360deg);
  }
}

/* Pulsing emerald glow for the glass CTA's border. */
@keyframes border-glow {
  0%,
  100% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 10px rgba(16, 185, 129, 0.45),
      0 0 22px rgba(16, 185, 129, 0.25);
  }
  50% {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 17px rgba(16, 185, 129, 0.75),
      0 0 36px rgba(16, 185, 129, 0.45);
  }
}
.glow-border {
  animation: border-glow 2.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .glow-border {
    animation: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 14px rgba(16, 185, 129, 0.6);
  }
}

.liquid-glass {
  background: rgba(255, 255, 255, 0.01);
  background-blend-mode: luminosity;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: none;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
}

.liquid-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.4px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.45) 0%,
    rgba(255, 255, 255, 0.15) 20%,
    rgba(255, 255, 255, 0) 40%,
    rgba(255, 255, 255, 0) 60%,
    rgba(255, 255, 255, 0.15) 80%,
    rgba(255, 255, 255, 0.45) 100%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

/* ── Animated gradient border (BorderRotate) ─────────────────────────────────
   The conic gradient rotates by animating the custom property --gradient-angle.
   A CSS custom property can only animate if it's registered with @property,
   so this block is required for the rotation to work. */
@property --gradient-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes gradient-rotate {
  to {
    --gradient-angle: 360deg;
  }
}

.gradient-border-auto {
  animation: gradient-rotate var(--animation-duration, 5s) linear infinite;
}
.gradient-border-hover:hover {
  animation: gradient-rotate var(--animation-duration, 5s) linear infinite;
}
.gradient-border-stop-hover {
  animation: gradient-rotate var(--animation-duration, 5s) linear infinite;
}
.gradient-border-stop-hover:hover {
  animation-play-state: paused;
}

/* ── Animated gradient headline ──────────────────────────────────────────── */
@keyframes headline-sweep {
  to {
    background-position: 200% center;
  }
}
.headline-gradient {
  background: linear-gradient(90deg, #ffffff 0%, #e9d5ff 25%, #c084fc 50%, #e9d5ff 75%, #ffffff 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: headline-sweep 6s linear infinite;
}

/* ── Purple focus rings across interactive elements (keyboard only) ───────── */
:where(button, a, input, textarea, select):focus-visible {
  outline: 2px solid rgba(168, 85, 247, 0.65);
  outline-offset: 2px;
  border-radius: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .headline-gradient {
    animation: none;
  }
}

```

---

## `server/index.ts`

```tsx
import 'dotenv/config'
import express from 'express'
import path from 'path'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import { planTasks } from './agent/planner.js'
import { executeTask, synthesize } from './agent/executor.js'
import { reviewResult } from './agent/critic.js'
import { getClarifyingQuestions } from './agent/clarify.js'
import { verifyLLMKey } from './agent/llm.js'
import { generateResultPdf } from './agent/pdf.js'
import { sendPdfEmail } from './agent/tools.js'
import { signup, login } from './auth.js'
import type { WSMessage, Task } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Download files the writer agent saved to agent_workspace, so the chat can
// offer them as download chips. Same path confinement as the write_file tool.
app.get('/files/*', (req, res) => {
  const rel = decodeURIComponent((req.params as Record<string, string>)[0] ?? '')
  const base = path.resolve('./agent_workspace')
  const safe = path.resolve(base, rel.replace(/^[/\\]+/, ''))
  if (safe === base || !safe.startsWith(base + path.sep)) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }
  res.download(safe, path.basename(safe), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
  })
})

// ── Auth routes ─────────────────────────────────────────────────────────────
// In-memory rate limit: 10 auth attempts per IP per 5 minutes. Enough for a
// human who typoed a password; a wall for credential-stuffing scripts.
const authHits = new Map<string, number[]>()
function authLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < 5 * 60_000)
  if (hits.length >= 10) {
    res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' })
    return
  }
  hits.push(now)
  authHits.set(ip, hits)
  next()
}

app.post('/auth/signup', authLimiter, (req, res) => {
  try {
    const { name, email, password } = req.body ?? {}
    res.json(signup(name, email, password))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/auth/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    res.json(login(email, password))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

type Delivery = 'screen' | 'email'

interface Incoming {
  type?: 'start' | 'clarify' | 'approve' | 'cancel' | 'followup'
  goal?: string
  delivery?: string
  email?: string
  answers?: { question: string; answer: string }[]
  // Chat-style clients auto-approve everything — let them skip the
  // clarifying-questions LLM call entirely instead of discarding it.
  skipClarify?: boolean
}

wss.on('connection', (ws: WebSocket, req) => {
  // Browsers send an Origin header — reject cross-site pages so a random
  // website can't drive the agent. Non-browser clients (no Origin) pass,
  // which keeps local tooling working.
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    ws.close(1008, 'Origin not allowed')
    return
  }
  console.log('Client connected')

  const send = (msg: WSMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  // ── Per-connection conversation state ──────────────────────────────────────
  let pending: { goal: string; title: string; delivery: Delivery; email: string } | null = null
  let proposedTasks: Task[] = []
  let lastSummary = '' // carried into follow-ups as context
  let lastDelivery: Delivery = 'screen'
  let lastEmail = ''
  let busy = false // ignore overlapping commands while one is in flight

  // Run the approved/clarified plan and deliver the result.
  async function runAndDeliver(goal: string, title: string, delivery: Delivery, email: string, tasks: Task[]) {
    send({ type: 'plan', payload: tasks })

    const completed: { description: string; result: string }[] = []
    for (const task of tasks) {
      send({ type: 'task_start', payload: task })
      try {
        const result = await executeTask(task, send, { goal, previous: completed })
        task.status = 'done'
        task.result = result
        completed.push({ description: task.description, result })
      } catch {
        task.status = 'done'
        task.result = 'Step skipped — the AI service was busy.'
        completed.push({ description: task.description, result: task.result })
      }
      send({ type: 'task_done', payload: task })
    }

    send({ type: 'log', payload: 'Synthesizing final answer…' })
    let summary = await synthesize(goal, tasks)

    // Critic reviews the team's answer; one bounded revision if it's weak.
    send({ type: 'log', payload: '🧐 Critic reviewing the result…' })
    const review = await reviewResult(title, summary)
    if (!review.ok && review.feedback) {
      send({ type: 'log', payload: `Critic requested a revision: ${review.feedback}` })
      summary = await synthesize(goal, tasks, review.feedback)
    }
    lastSummary = summary

    if (delivery === 'email') {
      send({ type: 'log', payload: `Generating PDF and emailing to ${email}…` })
      const pdf = await generateResultPdf(title, summary)
      const intro = `Hi,\n\nYour Equilibrium AI Agent report for "${title}" is attached as a PDF.\n\n— Equilibrium`
      const mail = await sendPdfEmail(email, `Your Equilibrium report: ${title}`, intro, pdf)
      send({
        type: 'agent_done',
        payload: { goal: title, tasks, summary, delivery, email, emailOk: mail.success, emailInfo: mail.output },
      })
    } else {
      send({ type: 'agent_done', payload: { goal: title, tasks, summary, delivery } })
    }
  }

  async function proposePlan() {
    if (!pending) return
    send({ type: 'log', payload: 'Drafting a plan…' })
    proposedTasks = await planTasks(pending.goal)
    send({ type: 'plan_proposed', payload: { tasks: proposedTasks } })
  }

  ws.on('message', async (raw) => {
    let data: Incoming
    try {
      data = JSON.parse(raw.toString()) as Incoming
    } catch {
      send({ type: 'agent_error', payload: 'Invalid message format' })
      return
    }

    if (busy) return // a command is already running; ignore extras
    busy = true
    try {
      switch (data.type) {
        case 'start': {
          const goal = (data.goal ?? '').trim()
          if (!goal) {
            send({ type: 'agent_error', payload: 'No goal provided' })
            break
          }
          const delivery: Delivery = data.delivery === 'email' ? 'email' : 'screen'
          const email = (data.email ?? '').trim()
          if (delivery === 'email' && !email) {
            send({ type: 'agent_error', payload: 'No email provided for email delivery' })
            break
          }
          pending = { goal, title: goal, delivery, email }
          lastDelivery = delivery
          lastEmail = email

          if (data.skipClarify) {
            await proposePlan()
            break
          }
          send({ type: 'log', payload: 'Reviewing your request…' })
          const questions = await getClarifyingQuestions(goal)
          if (questions.length) {
            send({ type: 'clarify', payload: { questions } })
          } else {
            await proposePlan()
          }
          break
        }

        case 'clarify': {
          if (!pending) break
          const detail = (data.answers ?? [])
            .filter((a) => a && String(a.answer ?? '').trim())
            .map((a) => `- ${a.question} → ${a.answer}`)
            .join('\n')
          if (detail) pending.goal = `${pending.title}\n\nAdditional details from the user:\n${detail}`
          await proposePlan()
          break
        }

        case 'approve': {
          if (!pending) break
          const { goal, title, delivery, email } = pending
          const tasks = proposedTasks.length ? proposedTasks : await planTasks(goal)
          pending = null
          proposedTasks = []
          await runAndDeliver(goal, title, delivery, email, tasks)
          break
        }

        case 'cancel': {
          pending = null
          proposedTasks = []
          send({ type: 'cancelled', payload: null })
          break
        }

        case 'followup': {
          const fg = (data.goal ?? '').trim()
          if (!fg) break
          const goal = lastSummary
            ? `Earlier you produced this result:\n${lastSummary.slice(0, 800)}\n\nThe user now asks: ${fg}\nUse the earlier result as context.`
            : fg
          send({ type: 'log', payload: 'Working on your follow-up…' })
          const tasks = await planTasks(goal)
          await runAndDeliver(goal, fg, lastDelivery, lastEmail, tasks)
          break
        }

        default:
          send({ type: 'agent_error', payload: 'Unknown request' })
      }
    } catch {
      send({ type: 'agent_error', payload: 'The AI service is busy right now. Please try again in a minute.' })
    } finally {
      busy = false
    }
  })

  ws.on('close', () => console.log('Client disconnected'))
})

const PORT = process.env.PORT ?? 4000
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Agent server running on http://localhost:${PORT}`)
  console.log(`   WebSocket ready on ws://localhost:${PORT}\n`)
  void verifyLLMKey()
})

```

---

## `server/auth.ts`

```tsx
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ── Simple file-backed user store with scrypt-hashed passwords ──────────────────
// Good enough for a demo: users persist to users.json, sessions live in memory.

export interface User {
  name: string
  email: string
  salt: string
  hash: string
  createdAt: string
}

export interface PublicUser {
  name: string
  email: string
  token: string
}

const USERS_FILE = path.resolve('./users.json')
const sessions = new Map<string, string>() // token -> email

function loadUsers(): Record<string, User> {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveUsers(users: Record<string, User>): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8')
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function newToken(email: string): string {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, email)
  return token
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export function signup(name: string, email: string, password: string): PublicUser {
  email = (email ?? '').trim().toLowerCase()
  name = (name ?? '').trim()
  if (!isEmail(email)) throw new Error('Please enter a valid email address.')
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.')

  const users = loadUsers()
  if (users[email]) throw new Error('An account with this email already exists.')

  const salt = crypto.randomBytes(16).toString('hex')
  users[email] = {
    name: name || email.split('@')[0],
    email,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  }
  saveUsers(users)

  return { name: users[email].name, email, token: newToken(email) }
}

export function login(email: string, password: string): PublicUser {
  email = (email ?? '').trim().toLowerCase()
  const users = loadUsers()
  const user = users[email]
  if (!user) throw new Error('No account found with this email.')

  const attempt = hashPassword(password ?? '', user.salt)
  // timing-safe compare
  const ok =
    attempt.length === user.hash.length &&
    crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(user.hash))
  if (!ok) throw new Error('Incorrect password.')

  return { name: user.name, email, token: newToken(email) }
}

// Resolve a session token back to its email (used to authorize the agent run).
export function emailForToken(token?: string): string | null {
  if (!token) return null
  return sessions.get(token) ?? null
}

```

---

## `server/types.ts`

```tsx
// Which specialist agent handles a task (the swarm divides work by role).
export type AgentRole = 'researcher' | 'writer' | 'analyst' | 'generalist'

export interface Task {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: string
  role?: AgentRole
}

export interface AgentPlan {
  goal: string
  tasks: Task[]
}

export type DeliveryMode = 'screen' | 'email'

export interface AgentRequest {
  goal: string
  delivery?: DeliveryMode
  email?: string
  token?: string
}

export type ToolName =
  | 'web_search'
  | 'write_file'
  | 'call_api'
  | 'send_email'
  | 'run_code'

export interface ToolCall {
  name: ToolName
  args: Record<string, unknown>
}

export type WSMessageType =
  | 'clarify'
  | 'plan_proposed'
  | 'plan'
  | 'task_start'
  | 'task_done'
  | 'task_failed'
  | 'tool_call'
  | 'tool_result'
  | 'agent_done'
  | 'agent_error'
  | 'cancelled'
  | 'log'

export interface WSMessage {
  type: WSMessageType
  payload: unknown
}

```

---

## `server/agent/llm.ts`

```tsx
import OpenAI from 'openai'

// Centralized LLM access via NVIDIA's NIM API, with automatic model fallback.
//
// NVIDIA's endpoint (https://integrate.api.nvidia.com/v1) is OpenAI-compatible,
// so we use the standard OpenAI SDK pointed at it. When the primary model hits
// a 429 rate limit, we transparently retry the same request on the next model
// in the chain — each hosted model has its own quota bucket, so falling back
// keeps the agent working.

// Defaults picked by benchmarking tool-calling on this account's catalog (2026-07-02):
// nemotron-super answered a tool-call prompt correctly in ~5s; minimax-m2.7 was
// correct but ~26s; minimax-m3 ignored tools; kimi-k2.6 emitted corrupt arguments.
const PRIMARY = process.env.NVIDIA_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
const FALLBACKS = (
  process.env.NVIDIA_FALLBACK_MODELS ||
  'minimaxai/minimax-m2.7,meta/llama-3.3-70b-instruct,meta/llama-3.1-8b-instruct'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const MODEL_CHAIN = [PRIMARY, ...FALLBACKS.filter((m) => m !== PRIMARY)]

// Small-first chain for lightweight judgment calls (critic, clarify) where
// latency matters more than depth — ~1-2s instead of ~5s per call.
const FAST_PRIMARY = process.env.NVIDIA_FAST_MODEL || 'meta/llama-3.1-8b-instruct'
export const FAST_CHAIN = [FAST_PRIMARY, ...MODEL_CHAIN.filter((m) => m !== FAST_PRIMARY)]

// Type aliases so callers don't import any provider SDK directly.
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
export type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion

let client: OpenAI | null = null
function nvidiaClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  }
  return client
}

// Boot-time check so a missing/rejected key is obvious in the server log
// instead of surfacing later as silent fallback answers.
export async function verifyLLMKey(): Promise<void> {
  if (!process.env.NVIDIA_API_KEY) {
    console.warn('⚠️  NVIDIA_API_KEY is not set in server/.env — the agent will only return fallback text.')
    console.warn('   Get a key at https://build.nvidia.com and add it to server/.env')
    return
  }
  try {
    const models = await nvidiaClient().models.list()
    const ids = new Set(models.data.map((m) => m.id))
    const missing = MODEL_CHAIN.filter((m) => !ids.has(m))
    console.log(`✅ NVIDIA API key OK — primary model: ${MODEL_CHAIN[0]}`)
    if (missing.length) {
      console.warn(`⚠️  Not in NVIDIA's model catalog (check for typos): ${missing.join(', ')}`)
    }
  } catch (err) {
    const status = (err as { status?: number })?.status
    console.warn(`⚠️  NVIDIA API check failed${status ? ` (HTTP ${status})` : ''} — the key in server/.env was rejected.`)
  }
}

export function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string }
  if (e?.status === 429) return true
  if (e?.code === 'rate_limit_exceeded') return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return msg.includes('rate limit') || msg.includes('too many requests')
}

// A 413 (or context-length 400): the single request exceeds the model's input
// limit. Switching models won't necessarily help — the caller must shrink the
// request. Exported so the executor can react by trimming context.
export function isRequestTooLarge(err: unknown): boolean {
  const e = err as { status?: number; message?: string }
  if (e?.status === 413) return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return (
    msg.includes('request too large') ||
    msg.includes('reduce your message size') ||
    msg.includes('maximum context length')
  )
}

// Model id isn't in this account's catalog (renamed, retired, or gated).
// Treated like a rate limit so the chain advances instead of crashing the task.
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string }
  if (e?.status === 404) return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return msg.includes('model not found') || msg.includes('no such model') || msg.includes('does not exist')
}

// Reasoning models (MiniMax-M2, Nemotron, DeepSeek-R1…) can emit <think>…</think>
// traces inline. Strip them so they never leak into tool loops or rendered Markdown.
function stripThink(completion: ChatCompletion): ChatCompletion {
  for (const choice of completion.choices) {
    const c = choice.message?.content
    if (typeof c === 'string' && c.includes('<think>')) {
      choice.message.content = c
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        // Truncated output can leave an unclosed <think> — drop it to the end.
        // If that empties the content, the empty-response fallback takes over.
        .replace(/<think>[\s\S]*$/, '')
        .trim()
    }
  }
  return completion
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Parse a "try again in 17m25.44s"-style hint if present; default to 60s.
function parseRetryMs(err: unknown): number {
  const msg = (err as { message?: string })?.message ?? String(err)
  const m = msg.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i)
  if (m) {
    const mins = m[1] ? parseInt(m[1], 10) : 0
    const secs = m[2] ? parseFloat(m[2]) : 0
    return Math.ceil((mins * 60 + secs) * 1000)
  }
  return 60_000
}

// Remember which models are rate-limited so we skip them until their quota resets,
// instead of wasting a round-trip on a known-dead model for every call.
const cooldownUntil = new Map<string, number>()

type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
type ChatParams = Omit<CreateBody, 'model' | 'stream'>

export interface ChatResult {
  completion: ChatCompletion
  model: string
}

// Per-model request tuning. Reasoning models (Nemotron, MiniMax, DeepSeek…)
// burn completion tokens "thinking" before the answer — a 1024 budget can be
// consumed entirely by reasoning, yielding an empty content string. Give them
// headroom, and switch Nemotron's reasoning off outright (the swarm never
// reads it; answers get faster and the whole budget goes to actual output).
function adjustForModel(params: ChatParams, model: string): CreateBody {
  const body = { ...params, model } as CreateBody
  // Models that think inline need budget headroom for reasoning + answer.
  // Nemotron is excluded: we disable its thinking below, so the caller's
  // budget is all answer — and a tight budget keeps generation fast.
  if (/minimax|deepseek|qwen3/i.test(model)) {
    body.max_tokens = Math.max(body.max_tokens ?? 1024, 4096)
  }
  if (/nemotron/i.test(model)) {
    const msgs = [...(body.messages ?? [])]
    const first = msgs[0]
    if (first?.role === 'system' && typeof first.content === 'string') {
      // Merge into the existing system prompt — a second system message can
      // confuse the model and degrade structured (JSON) output.
      if (!first.content.includes('/no_think')) {
        msgs[0] = { ...first, content: `/no_think\n${first.content}` }
      }
    } else {
      msgs.unshift({ role: 'system', content: '/no_think' })
    }
    body.messages = msgs
  }
  return body
}

// Run a chat completion, falling back through MODEL_CHAIN on rate-limit errors.
// Non-rate-limit errors (e.g. a 400 from a malformed tool call) are re-thrown
// so the caller can apply its own recovery.
export async function chatWithFallback(
  params: ChatParams,
  onFallback?: (from: string, to: string, reason: string) => void,
  chain: string[] = MODEL_CHAIN
): Promise<ChatResult> {
  const nvidia = nvidiaClient()
  let lastErr: unknown

  // Up to 2 rounds: if every model is rate-limited but a quota resets soon
  // (per-minute limits), wait briefly and try again instead of failing.
  for (let round = 0; round < 2; round++) {
    const now = Date.now()
    const ready = chain.filter((m) => (cooldownUntil.get(m) ?? 0) <= now)
    const order = ready.length ? ready : chain

    for (let i = 0; i < order.length; i++) {
      const model = order[i]
      try {
        const completion = stripThink(await nvidia.chat.completions.create(adjustForModel(params, model)))
        const msg = completion.choices[0]?.message
        // Empty answer with no tool calls = the model produced nothing usable
        // (e.g. reasoning consumed the whole budget). Try the next model.
        if (msg && !msg.tool_calls?.length && !msg.content?.trim() && i < order.length - 1) {
          console.warn(`[llm] ${model} returned empty content (finish: ${completion.choices[0]?.finish_reason}) — trying next model`)
          onFallback?.(model, order[i + 1], 'empty response')
          continue
        }
        return { completion, model }
      } catch (err) {
        lastErr = err
        const e = err as { status?: number; message?: string }
        console.warn(`[llm] ${model} failed (HTTP ${e?.status ?? '?'}): ${(e?.message ?? String(err)).slice(0, 300)}`)
        if (isModelUnavailable(err)) {
          // Bad/renamed model id — bench it for an hour and try the next one.
          cooldownUntil.set(model, Date.now() + 60 * 60_000)
          if (i < order.length - 1) {
            onFallback?.(model, order[i + 1], 'model unavailable')
            continue
          }
        } else if (isRateLimit(err)) {
          cooldownUntil.set(model, Date.now() + parseRetryMs(err))
          if (i < order.length - 1) {
            onFallback?.(model, order[i + 1], 'rate limit reached')
            continue
          }
        } else {
          throw err // 413, 400 tool_use_failed, etc. — caller handles
        }
      }
    }

    // All models are rate-limited. Per-minute limits reset within ~60s, so wait
    // them out (up to ~65s) instead of surfacing an error to the user.
    const soonest = Math.min(...chain.map((m) => cooldownUntil.get(m) ?? 0))
    const waitMs = soonest - Date.now()
    if (round === 0 && waitMs > 0 && waitMs <= 65_000) {
      onFallback?.('all models', chain[0], `rate limited — waiting ${Math.ceil(waitMs / 1000)}s for quota to reset`)
      await sleep(waitMs + 500)
      continue
    }
    break
  }
  throw lastErr
}

```

---

## `server/agent/planner.ts`

```tsx
import { chatWithFallback } from './llm.js'
import { normalizeRole } from './roles.js'
import type { Task } from '../types.js'

const PLANNER_PROMPT = `You are the ORCHESTRATOR of a multi-agent AI team. Divide the user's goal into the
SMALLEST set of concrete, ordered subtasks (usually 2-3) and assign EACH subtask to the right specialist.

The team shares memory: every subtask automatically receives the results of all earlier subtasks, so a
"gather" subtask can feed a "use it" subtask.

Specialists (set "role" to one of these) and the tools they can use:
- "researcher" — gathers information from the web (web_search)
- "writer" — produces and saves documents (write_file)
- "analyst" — computation and data work (run_code, call_api)
- "generalist" — mixed tasks needing several tools

Guidelines:
- Assign the role whose tools match the subtask. Research before writing; analyze before reporting.
- Keep it SHORT (2-3 subtasks). Avoid redundant or vague subtasks.
- Do NOT create subtasks that email or notify the user — delivery is handled separately.
- Make descriptions specific (what to search, what file to write, what it should contain).

Respond ONLY with a valid JSON array, no explanation, no markdown. Example:
[
  { "id": "1", "description": "Search the web for the top 5 AI agent frameworks of 2024 and their key features", "role": "researcher", "status": "pending" },
  { "id": "2", "description": "Write a structured summary of those frameworks to ai_frameworks.txt using the research", "role": "writer", "status": "pending" }
]`

export async function planTasks(goal: string): Promise<Task[]> {
  // Single-task fallback — used if the planner is rate-limited or returns junk,
  // so a planning hiccup never errors out the whole run.
  const fallbackPlan: Task[] = [{ id: '1', description: goal, status: 'pending', role: 'generalist' }]

  let text = ''
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: `User goal: ${goal}` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    })
    text = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch {
    return fallbackPlan
  }

  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  // Models sometimes wrap the JSON in prose — salvage the outermost array.
  const arrayMatch = clean.startsWith('[') ? null : clean.match(/\[[\s\S]*\]/)

  try {
    const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : clean)
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Planner did not return tasks')
    return parsed.map((t, i) => ({
      id: t?.id ?? String(i + 1),
      description: String(t?.description ?? goal),
      status: t?.status ?? 'pending',
      role: normalizeRole(t?.role),
    }))
  } catch {
    console.warn('[planner] unparseable plan, using single-task fallback. Output began:', text.slice(0, 160))
    return fallbackPlan
  }
}

```

---

## `server/agent/roles.ts`

```tsx
import type { AgentRole, ToolName } from '../types.js'

export interface RoleSpec {
  label: string
  icon: string
  /** Tools this specialist is allowed to call. */
  tools: ToolName[]
  /** System prompt that specializes the shared executor for this role. */
  prompt: string
}

// Rules shared by every specialist.
const SHARED_RULES = `Hard rules:
- NEVER output placeholder text (e.g. "Research results: ...", "Feature 1", "content here"). Produce real, specific, complete content.
- If results from earlier teammates are provided, treat them as your source material and build on them — don't re-do their work or invent filler.
- Tool arguments must be valid JSON. For web_search use exactly: {"query": "your search terms"}. No XML or extra wrapping.
- When finished, reply with a short note stating exactly what you produced.`

export const ROLES: Record<AgentRole, RoleSpec> = {
  researcher: {
    label: 'Researcher',
    icon: '🔍',
    tools: ['web_search'],
    prompt: `You are the RESEARCHER, a specialist agent in a multi-agent team. Your job is to gather accurate, current information using web_search and report concrete findings (facts, figures, sources). Search first, then summarize what you actually found — never guess.
${SHARED_RULES}`,
  },
  writer: {
    label: 'Writer',
    icon: '✍️',
    tools: ['write_file'],
    prompt: `You are the WRITER, a specialist agent in a multi-agent team. Your job is to turn the material gathered by teammates into a clear, complete, well-structured document and save it with write_file. The file content must be the full finished piece, not a stub.
${SHARED_RULES}`,
  },
  analyst: {
    label: 'Analyst',
    icon: '🧮',
    tools: ['run_code', 'call_api'],
    prompt: `You are the ANALYST, a specialist agent in a multi-agent team. Your job is computation and data work: use run_code for calculations/parsing and call_api for external data. Show the actual numbers/results you computed.
${SHARED_RULES}`,
  },
  generalist: {
    label: 'Agent',
    icon: '🤖',
    tools: ['web_search', 'write_file', 'call_api', 'run_code'],
    prompt: `You are a GENERALIST agent with access to all tools. Complete the task end to end, using whichever tools fit.
${SHARED_RULES}`,
  },
}

const VALID = new Set<AgentRole>(['researcher', 'writer', 'analyst', 'generalist'])

export function normalizeRole(role: unknown): AgentRole {
  return typeof role === 'string' && VALID.has(role as AgentRole) ? (role as AgentRole) : 'generalist'
}

```

---

## `server/agent/executor.ts`

```tsx
import type { Task, WSMessage, ToolName } from '../types.js'
import { webSearch, writeFile, callApi, runCode } from './tools.js'
import {
  chatWithFallback,
  isRequestTooLarge,
  isRateLimit,
  type ChatTool,
  type ChatMessage,
  type ChatCompletion,
} from './llm.js'
import { ROLES, normalizeRole } from './roles.js'

type Sender = (msg: WSMessage) => void

const SYNTH_PROMPT = `You are writing the final answer for an autonomous agent run.
Using the completed task results below, write a clear, complete answer that directly fulfills the user's goal.
Include the ACTUAL findings and content produced — not a description of what was done.
If files were written, mention them and include their key content. Be substantive but concise. No placeholders.

Format the answer as clean Markdown so it renders beautifully:
- Start with a short "# " title summarizing the result.
- Use "## " subheadings to group sections when helpful.
- Use "- " for bullet points and "1." for ordered lists.
- Use **bold** for key terms.
- Keep paragraphs short. Do not include code fences or HTML.`

const tools: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_api',
      description: 'Make an HTTP request. Supports headers and a JSON body for POST/PUT/PATCH.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          headers: { type: 'object', description: 'Optional HTTP headers as key/value pairs' },
          body: { type: 'object', description: 'Optional JSON request body' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: 'Run JavaScript code and return output',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
        required: ['code'],
      },
    },
  },
]

// Only treat plain objects as valid args. Arrays / strings / numbers are NOT
// valid tool arguments and must not be returned (they make args.query etc.
// silently undefined).
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  const direct = asRecord(raw)
  if (direct) return direct
  if (typeof raw !== 'string') return {}
  let s = raw.trim()

  // Try direct parse, unwrapping up to one layer of double-encoded JSON
  // (Llama/Groq sometimes returns arguments as a JSON-stringified string).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = JSON.parse(s)
      const rec = asRecord(parsed)
      if (rec) return rec
      if (typeof parsed === 'string') { s = parsed.trim(); continue }
    } catch { /* not valid JSON, fall through */ }
    break
  }

  // Strip XML/function tags: <function=name>{"key":"val"}</function>
  const xmlMatch = s.match(/>(\{[\s\S]*?\})</)
  if (xmlMatch) {
    try { const r = asRecord(JSON.parse(xmlMatch[1])); if (r) return r } catch { /* continue */ }
  }
  // Find first {...} block (greedy so nested braces are kept)
  const braceMatch = s.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try { const r = asRecord(JSON.parse(braceMatch[0])); if (r) return r } catch { /* continue */ }
  }
  // Last resort: extract key="value" pairs
  const pairs: Record<string, string> = {}
  const kvMatches = s.matchAll(/["']?(\w+)["']?\s*[:=]\s*["']([^"']+)["']/g)
  for (const m of kvMatches) pairs[m[1]] = m[2]
  return pairs
}

const TOOL_NAMES = ['web_search', 'write_file', 'call_api', 'send_email', 'run_code']

// Llama-on-Groq sometimes emits a tool call in its own malformed syntax, e.g.
//   <function=web_search {"query": "..."} </function>
// Groq rejects the whole request with a 400 "tool_use_failed" and returns the
// raw generation in `failed_generation`. Recover the intended call from it so a
// single bad format string doesn't kill the task.
function extractFailedToolCall(
  err: unknown
): { name: string; args: Record<string, unknown> } | null {
  const anyErr = err as { error?: { failed_generation?: string }; message?: string }
  const failed =
    anyErr?.error?.failed_generation ??
    (typeof anyErr?.message === 'string' ? anyErr.message : undefined) ??
    (typeof err === 'string' ? err : String(err))
  if (!failed) return null

  // <function=name ...args...</function>  or  <function=name>...args...</function>
  let m = failed.match(/<function=([a-zA-Z_]\w*)\s*>?([\s\S]*?)<\/function>/)
  if (m && TOOL_NAMES.includes(m[1])) return { name: m[1], args: parseArgs(m[2]) }

  // {"name":"...","arguments":{...}}
  m = failed.match(/"name"\s*:\s*"([a-zA-Z_]\w*)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*\})/)
  if (m && TOOL_NAMES.includes(m[1])) return { name: m[1], args: parseArgs(m[2]) }

  // Last resort: any known tool name + the first {...} block
  const nameM = failed.match(new RegExp(`(${TOOL_NAMES.join('|')})`))
  if (nameM) {
    const braceM = failed.match(/\{[\s\S]*\}/)
    return { name: nameM[1], args: braceM ? parseArgs(braceM[0]) : {} }
  }
  return null
}

// Coerce any LLM-supplied value to a string. Models sometimes pass objects or
// numbers where a string is expected (e.g. write_file path), which crashes the
// underlying tool with [object Object] / ERR_INVALID_ARG_TYPE.
function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'web_search':
      return (await webSearch(toStr(args.query))).output
    case 'write_file': {
      // The path may arrive as a nested object; dig out a usable filename.
      let rawPath: unknown = args.path
      if (rawPath && typeof rawPath === 'object') {
        const o = rawPath as Record<string, unknown>
        rawPath = o.path ?? o.file ?? o.filename ?? o.name ?? ''
      }
      let filePath = toStr(rawPath).trim()
      if (!filePath || filePath === '[object Object]') filePath = `output_${Date.now()}.txt`
      const content = toStr(args.content)
      return (await writeFile(filePath, content)).output
    }
    case 'call_api':
      return (await callApi(
        toStr(args.url),
        toStr(args.method) || 'GET',
        (asRecord(args.headers) as Record<string, string>) || {},
        args.body
      )).output
    case 'run_code':
      return (await runCode(toStr(args.code))).output
    default:
      return `Unknown tool: ${name}`
  }
}

export interface ExecContext {
  goal: string
  previous: { description: string; result: string }[]
}

// Free-tier Groq models have a ~6k tokens-per-minute cap, so we keep each
// request small: cap how much of each tool result and prior-task result we feed
// back into the conversation (~4 chars/token).
const TOOL_RESULT_CAP = 700
const PREV_RESULT_CAP = 600

export async function executeTask(task: Task, send: Sender, ctx: ExecContext): Promise<string> {
  const notifyFallback = (from: string, to: string, reason: string) =>
    send({ type: 'log', payload: `${reason} on ${from} — falling back to ${to}` })

  // Feed the results of earlier completed tasks in as source material so that
  // "use the data" tasks actually have the data the "gather" tasks produced.
  // Only the most recent few, capped, to stay under the token-per-minute limit.
  const previousBlock = ctx.previous.length
    ? '\n\nResults from earlier completed tasks (REAL data — use this as your source, do not re-invent it):\n' +
      ctx.previous
        .slice(-3)
        .map((p, i) => `[${i + 1}] ${p.description}\n${p.result.slice(0, PREV_RESULT_CAP)}`)
        .join('\n\n')
    : ''

  // Pick the specialist for this subtask: its focused prompt + only its tools.
  const role = normalizeRole(task.role)
  const spec = ROLES[role]
  const roleTools = tools.filter((t) => {
    const fn = (t as { function?: { name?: string } }).function
    return !!fn?.name && spec.tools.includes(fn.name as ToolName)
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: spec.prompt },
    {
      role: 'user',
      content: `Overall goal: ${ctx.goal}\n\nYour current task: ${task.description}${previousBlock}`,
    },
  ]

  send({ type: 'log', payload: `${spec.icon} ${spec.label}: ${task.description}` })

  for (let i = 0; i < 6; i++) {
    let response: ChatCompletion
    try {
      response = (
        await chatWithFallback(
          { messages, tools: roleTools, tool_choice: 'auto', max_tokens: 1024, temperature: 0.1 },
          notifyFallback
        )
      ).completion
    } catch (err) {
      // Request too large (413) or service still rate-limited after fallback +
      // wait: stop gathering and summarize what we have, rather than failing.
      if (isRequestTooLarge(err) || isRateLimit(err)) {
        send({ type: 'log', payload: 'Service busy — summarizing what was gathered so far' })
        break
      }

      // Recover from Groq's 400 "tool_use_failed" by salvaging the malformed
      // tool call, running it, and feeding the result back as plain context.
      const recovered = extractFailedToolCall(err)
      if (!recovered) {
        // Any other unexpected error: don't crash the task — summarize so far.
        send({ type: 'log', payload: 'Recovering from an unexpected error — summarizing so far' })
        break
      }

      send({ type: 'tool_call', payload: { tool: recovered.name, args: recovered.args } })
      let result: string
      try {
        result = await dispatchTool(recovered.name, recovered.args)
      } catch (e) {
        result = `Error: ${String(e)}`
      }
      send({ type: 'tool_result', payload: { tool: recovered.name, result: result.slice(0, 800) } })

      messages.push({ role: 'assistant', content: `Called ${recovered.name}(${JSON.stringify(recovered.args)})` })
      messages.push({ role: 'user', content: `Result of ${recovered.name}:\n${result.slice(0, TOOL_RESULT_CAP)}` })
      continue
    }

    const message = response.choices[0]?.message
    if (!message) break
    // Re-send only standard fields — NVIDIA attaches extras (reasoning_content)
    // that some endpoints reject when echoed back in the conversation.
    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    })

    if (!message.tool_calls?.length) {
      return message.content?.trim() || 'Task completed.'
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue // narrow the union; we only define function tools
      const name = toolCall.function.name
      const args = parseArgs(toolCall.function.arguments)

      send({ type: 'tool_call', payload: { tool: name, args } })

      let result: string
      try {
        result = await dispatchTool(name, args)
      } catch (err) {
        result = `Error: ${String(err)}`
      }

      send({ type: 'tool_result', payload: { tool: name, result: result.slice(0, 800) } })

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.slice(0, TOOL_RESULT_CAP),
      })
    }
  }

  // Tool-call budget exhausted. Do one final pass WITHOUT tools so the model
  // can summarize using the results it just gathered, instead of discarding
  // them and returning a generic message.
  try {
    const { completion: final } = await chatWithFallback(
      {
        messages: [
          ...messages,
          { role: 'user', content: 'Summarize the result of the task based on the work above.' },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      },
      notifyFallback
    )
    const summary = final.choices[0]?.message?.content?.trim()
    if (summary) return summary
  } catch { /* fall through */ }

  return 'Task completed (reached step limit).'
}

// Produce a real, consolidated final answer from all task results instead of a
// generic "Completed X/Y tasks" line.
export async function synthesize(goal: string, tasks: Task[], feedback?: string): Promise<string> {
  const done = tasks.filter((t) => t.status === 'done').length
  const fallback = `Completed ${done}/${tasks.length} tasks.`

  try {
    const work = tasks
      .map((t) => `Task: ${t.description}\nStatus: ${t.status}\nResult: ${(t.result ?? '(none)').slice(0, 800)}`)
      .join('\n\n')

    const revision = feedback
      ? `\n\nA reviewer flagged the previous draft. Address this feedback in your answer: ${feedback}`
      : ''

    const { completion: res } = await chatWithFallback({
      messages: [
        { role: 'system', content: SYNTH_PROMPT },
        {
          role: 'user',
          content: `User goal: ${goal}\n\nCompleted work:\n${work}${revision}\n\nWrite the final answer for the user.`,
        },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    })

    return res.choices[0]?.message?.content?.trim() || fallback
  } catch (err) {
    console.warn('[synthesize] LLM call failed:', (err as Error)?.message ?? err)
    return fallback
  }
}

```

---

## `server/agent/critic.ts`

```tsx
import { chatWithFallback, FAST_CHAIN } from './llm.js'

const CRITIC_PROMPT = `You are the CRITIC, the reviewer in a multi-agent AI team. Judge the team's final answer
against the user's goal: is it complete, accurate, on-topic, and free of placeholders or vague filler?

Be strict but fair. Respond ONLY with JSON, no markdown:
{"ok": true}                                         // if the answer is good enough
{"ok": false, "feedback": "what to fix in 1-2 sentences"}   // if it needs one revision`

export interface Review {
  ok: boolean
  feedback: string
}

// Review the final answer. Never throws and never blocks — on any failure it
// approves (ok: true), so the critic can only improve, never break, a run.
export async function reviewResult(goal: string, summary: string): Promise<Review> {
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: CRITIC_PROMPT },
        { role: 'user', content: `User goal: ${goal}\n\nThe team's answer:\n${summary.slice(0, 1600)}` },
      ],
      temperature: 0.2,
      max_tokens: 250,
    }, undefined, FAST_CHAIN)

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(clean) as { ok?: boolean; feedback?: string }

    return {
      ok: parsed?.ok !== false,
      feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
    }
  } catch {
    return { ok: true, feedback: '' }
  }
}

```

---

## `server/agent/clarify.ts`

```tsx
import { chatWithFallback, FAST_CHAIN } from './llm.js'

const CLARIFY_PROMPT = `You decide whether a user's goal for an autonomous AI agent is clear enough to execute well.

If the goal is already specific and actionable, respond exactly:
{"clear": true, "questions": []}

If it is vague or missing details that would materially change the result, ask 1-3 SHORT clarifying questions:
{"clear": false, "questions": ["...", "..."]}

Only ask about things that genuinely matter (scope, audience, format, time frame, specifics).
Do NOT ask more than 3 questions. Respond ONLY with JSON, no markdown, no explanation.`

// Returns up to 3 clarifying questions, or [] if the goal is clear enough.
// Never throws — on any failure we proceed without clarification.
export async function getClarifyingQuestions(goal: string): Promise<string[]> {
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: CLARIFY_PROMPT },
        { role: 'user', content: `Goal: ${goal}` },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }, undefined, FAST_CHAIN)

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(clean) as { clear?: boolean; questions?: unknown }

    if (parsed?.clear === true) return []
    if (!Array.isArray(parsed?.questions)) return []
    return parsed.questions
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 3)
  } catch {
    return []
  }
}

```

---

## `server/agent/tools.ts`

```tsx
import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import nodemailer from 'nodemailer'

const execAsync = promisify(exec)

export type ToolResult = { success: boolean; output: string }

// ── 1. Web Search ─────────────────────────────────────────────────────────────
// Order of attempts: Brave (if key) → DuckDuckGo HTML scrape (no key, real web
// results) → DuckDuckGo Instant Answer → Wikipedia. The HTML scrape is the
// workhorse that actually returns useful results without any API key.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').trim()
}

// Scrape DuckDuckGo's no-JS HTML endpoint. Returns formatted results or null.
async function duckDuckGoHtml(query: string): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const html = await res.text()

  const titleRe = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const titles: string[] = []
  const snippets: string[] = []
  let m: RegExpExecArray | null
  while ((m = titleRe.exec(html)) && titles.length < 5) titles.push(decodeEntities(m[1]))
  while ((m = snippetRe.exec(html)) && snippets.length < 5) snippets.push(decodeEntities(m[1]))

  if (titles.length === 0) return null
  const out = titles
    .map((t, i) => `• ${t}${snippets[i] ? `\n  ${snippets[i]}` : ''}`)
    .filter((line) => line.replace(/^•\s*/, '').trim().length > 0)
    .join('\n\n')
  return out || null
}

export async function webSearch(query: string): Promise<ToolResult> {
  try {
    if (!query?.trim()) return { success: false, output: 'No query provided' }

    // 1) Brave Search API (only if a key is configured)
    const braveKey = process.env.BRAVE_SEARCH_API_KEY
    if (braveKey) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
        })
        if (res.ok) {
          const data = (await res.json()) as {
            web?: { results?: Array<{ title: string; description: string; url: string }> }
          }
          const results = data.web?.results
            ?.map((r) => `• ${r.title}\n  ${decodeEntities(r.description)}\n  ${r.url}`)
            .join('\n\n')
          if (results) return { success: true, output: results }
        }
      } catch { /* fall through */ }
    }

    // 2) DuckDuckGo HTML scrape — real web results, no key required
    try {
      const ddg = await duckDuckGoHtml(query)
      if (ddg) return { success: true, output: ddg }
    } catch { /* fall through */ }

    // 3) DuckDuckGo Instant Answer API (sparse, but free)
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
        Results?: Array<{ Text?: string; FirstURL?: string }>
      }
      const parts: string[] = []
      if (data.AbstractText) parts.push(`${data.AbstractText}\nSource: ${data.AbstractURL}`)
      data.Results?.slice(0, 3).forEach((r) => r.Text && parts.push(`• ${r.Text}\n  ${r.FirstURL}`))
      data.RelatedTopics?.slice(0, 4).forEach((r) => r.Text && parts.push(`• ${r.Text}\n  ${r.FirstURL}`))
      if (parts.length > 0) return { success: true, output: parts.join('\n\n') }
    } catch { /* fall through */ }

    // 4) Wikipedia opensearch (last resort)
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`
      const wikiRes = await fetch(wikiUrl, { headers: { 'User-Agent': UA } })
      const wikiData = (await wikiRes.json()) as [string, string[], string[], string[]]
      const wikiResults = wikiData[1]
        ?.map((title, i) => `• ${title}\n  ${wikiData[2][i] ?? ''}\n  ${wikiData[3][i] ?? ''}`)
        .join('\n\n')
      if (wikiResults) return { success: true, output: wikiResults }
    } catch { /* fall through */ }

    return { success: false, output: 'No results found for this query.' }
  } catch (err) {
    return { success: false, output: `Search failed: ${String(err)}` }
  }
}

// ── 2. Write File ─────────────────────────────────────────────────────────────
export async function writeFile(filePath: string, content: string): Promise<ToolResult> {
  try {
    // Confine writes to the workspace — absolute paths and ../ escapes are
    // rejected (the path comes from the LLM, not a trusted caller).
    const base = path.resolve('./agent_workspace')
    const safePath = path.resolve(base, filePath.replace(/^[/\\]+/, ''))
    if (safePath !== base && !safePath.startsWith(base + path.sep)) {
      return { success: false, output: `Write failed: path escapes the workspace (${filePath})` }
    }
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    await fs.writeFile(safePath, content, 'utf8')
    return { success: true, output: `File written to agent_workspace/${filePath}` }
  } catch (err) {
    return { success: false, output: `Write failed: ${String(err)}` }
  }
}

// ── 3. Call External API ──────────────────────────────────────────────────────
export async function callApi(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: unknown
): Promise<ToolResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined || body === null
        ? undefined
        : (typeof body === 'string' ? body : JSON.stringify(body)),
    })
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    return { success: res.ok, output: JSON.stringify(parsed, null, 2).slice(0, 2000) }
  } catch (err) {
    return { success: false, output: `API call failed: ${String(err)}` }
  }
}

// ── 4. Send Email ─────────────────────────────────────────────────────────────
export async function sendEmail(to: string, subject: string, body: string): Promise<ToolResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text: body })
    return { success: true, output: `Email sent to ${to}` }
  } catch (err) {
    return { success: false, output: `Email failed: ${String(err)}` }
  }
}

// ── Send the result as a PDF attachment ────────────────────────────────────────
export async function sendPdfEmail(
  to: string,
  subject: string,
  intro: string,
  pdf: Buffer,
  filename = 'equilibrium-report.pdf'
): Promise<ToolResult> {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return { success: false, output: 'Email not configured (missing SMTP_USER / SMTP_PASS).' }
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      text: intro,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    })
    return { success: true, output: `Report emailed to ${to}` }
  } catch (err) {
    return { success: false, output: `Email failed: ${String(err)}` }
  }
}

// ── 5. Run Code ───────────────────────────────────────────────────────────────
export async function runCode(code: string): Promise<ToolResult> {
  try {
    const tmpFile = `./agent_workspace/_tmp_${Date.now()}.mjs`
    await fs.mkdir('./agent_workspace', { recursive: true })
    await fs.writeFile(tmpFile, code, 'utf8')
    const { stdout, stderr } = await execAsync(`node ${tmpFile}`, { timeout: 10000, maxBuffer: 10 * 1024 * 1024 })
    await fs.unlink(tmpFile).catch(() => {})
    return { success: true, output: stdout || stderr || '(no output)' }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { success: false, output: e.stderr ?? e.message ?? String(err) }
  }
}

```

---

## `server/agent/pdf.ts`

```tsx
import PDFDocument from 'pdfkit'

// Render the agent's result into a clean, readable PDF and return it as a Buffer.
// Understands a small Markdown subset: # / ## headings, - or • bullets,
// 1. numbered lists, **bold**, and blank-line paragraph breaks.
export function generateResultPdf(goal: string, summary: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    const chunks: Buffer[] = []

    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const INK = '#1a1a2e'
    const MUTED = '#6b7280'
    const ACCENT = '#4f46e5'

    // ── Header ──
    doc.fillColor(ACCENT).fontSize(22).font('Helvetica-Bold').text('Equilibrium')
    doc.moveDown(0.1)
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text('AI Agent Report')
    doc
      .moveTo(doc.x, doc.y + 6)
      .lineTo(doc.page.width - 56, doc.y + 6)
      .strokeColor('#e5e7eb')
      .lineWidth(1)
      .stroke()
    doc.moveDown(1)

    // ── Goal + date ──
    doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text('GOAL')
    doc.moveDown(0.2)
    doc.fillColor(INK).fontSize(12).font('Helvetica').text(goal)
    doc.moveDown(0.4)
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(`Generated ${new Date().toLocaleString()}`)
    doc.moveDown(1)

    // ── Body (markdown subset) ──
    const renderInline = (line: string, opts: PDFKit.Mixins.TextOptions = {}) => {
      // Split on **bold** and render runs, keeping them on one line.
      const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
      parts.forEach((part, i) => {
        const bold = part.startsWith('**') && part.endsWith('**')
        const text = bold ? part.slice(2, -2) : part
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(INK)
          .text(text, { continued: i < parts.length - 1, ...opts })
      })
    }

    const lines = summary.replace(/\r/g, '').split('\n')
    for (const raw of lines) {
      const line = raw.trimEnd()

      if (!line.trim()) {
        doc.moveDown(0.5)
        continue
      }
      // Skip stray Markdown code fences (```).
      if (/^```/.test(line.trim())) continue
      if (line.startsWith('### ')) {
        doc.moveDown(0.3)
        doc.fillColor(INK).fontSize(12).font('Helvetica-Bold').text(line.slice(4))
        doc.moveDown(0.15)
        continue
      }
      if (line.startsWith('## ')) {
        doc.moveDown(0.4)
        doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text(line.slice(3))
        doc.moveDown(0.2)
        continue
      }
      if (line.startsWith('# ')) {
        doc.moveDown(0.5)
        doc.fillColor(INK).fontSize(15).font('Helvetica-Bold').text(line.slice(2))
        doc.moveDown(0.2)
        continue
      }

      const bullet = line.match(/^[-•*]\s+(.*)$/)
      if (bullet) {
        doc.fontSize(11)
        doc.font('Helvetica').fillColor(ACCENT).text('•  ', { continued: true })
        renderInline(bullet[1], { indent: 0 })
        doc.moveDown(0.15)
        continue
      }

      const numbered = line.match(/^(\d+)\.\s+(.*)$/)
      if (numbered) {
        doc.fontSize(11)
        doc.font('Helvetica-Bold').fillColor(ACCENT).text(`${numbered[1]}.  `, { continued: true })
        renderInline(numbered[2])
        doc.moveDown(0.15)
        continue
      }

      doc.fontSize(11)
      renderInline(line)
      doc.moveDown(0.3)
    }

    // ── Footer ──
    doc.moveDown(2)
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text('Generated by Equilibrium AI Agent', { align: 'center' })

    doc.end()
  })
}

```

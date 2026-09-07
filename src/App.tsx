import { useEffect, useState } from 'react'
import { Home, FileText, Users, Search, Settings, Menu, BookOpen } from 'lucide-react'
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
  { name: 'Journal', icon: BookOpen, href: '/blog/' },
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
  // Google's callback sends the browser back here with a one-time code; the
  // auth modal swaps it for a session (or for the authenticator step).
  const [handoff, setHandoff] = useState<string | undefined>(() => {
    const code = new URLSearchParams(window.location.search).get('handoff')
    return code ?? undefined
  })
  const [authError, setAuthError] = useState(
    () => new URLSearchParams(window.location.search).get('auth_error') ?? ''
  )
  const [showSettings, setShowSettings] = useState(false)
  const toggleMenu = () => setIsOpen((v) => !v)
  const handleSelect = (name: string) => {
    if (name === 'Team') setView('team')
    if (name === 'Home') setView('home')
    if (name === 'News') setView('news')
    // The Journal (blog) is a separate Astro site mounted at /blog on the same
    // domain, so we navigate to it rather than switching an in-app view.
    if (name === 'Journal') window.location.href = '/blog/'
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

  // Open the modal for a Google return, and clean the code out of the URL so a
  // refresh (or a shared link) can't replay it.
  useEffect(() => {
    if (!handoff && !authError) return
    setShowAuth(true)
    window.history.replaceState({}, '', window.location.pathname)
  }, [handoff, authError])

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
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleGetStarted}
                className="glow-border inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-400/15 px-5 py-2.5 text-sm font-medium text-emerald-50 backdrop-blur-md transition-colors hover:border-emerald-200/90 hover:bg-emerald-400/25"
              >
                Get started
                <span aria-hidden>→</span>
              </button>
              <a
                href="/blog/"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-neutral-200 backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/10"
              >
                Read the Journal
              </a>
            </div>
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
          handoff={handoff}
          initialError={authError}
          onClose={() => {
            setShowAuth(false)
            setHandoff(undefined)
            setAuthError('')
          }}
          onSuccess={(u) => {
            setUser(u)
            localStorage.setItem('greenleaf-user', JSON.stringify(u))
            setShowAuth(false)
            setHandoff(undefined)
            setView('ai')
          }}
        />
      )}
    </div>
  )
}

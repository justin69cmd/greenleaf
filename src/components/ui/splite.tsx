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

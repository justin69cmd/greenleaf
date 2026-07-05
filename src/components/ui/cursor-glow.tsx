import { useEffect, useRef } from 'react'

/**
 * CursorGlow — a motion-based custom cursor.
 *
 * A small bright violet dot tracks the pointer exactly, while a larger soft ring
 * trails behind with easing. The ring is *motion-reactive*: it swells and
 * brightens when hovering an interactive element (button / link / field) and
 * contracts on press — giving every clickable target tactile feedback. Augments
 * the native cursor (doesn't hide it), is pointer-events-none, and only mounts
 * on devices with a fine pointer (mouse).
 */
const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"]'

export function CursorGlow() {
  const dotRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true
    if (!finePointer) return

    const dot = dotRef.current
    const ring = ringRef.current
    if (!dot || !ring) return

    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    let rx = mx
    let ry = my
    // Eased ring scale, driven toward `scaleTarget` every frame for smooth motion.
    let scale = 1
    let scaleTarget = 1
    let hovering = false
    let pressed = false
    let raf = 0
    let shown = false

    const updateTarget = () => {
      scaleTarget = (hovering ? 1.9 : 1) * (pressed ? 0.7 : 1)
      ring.style.borderColor = hovering ? 'rgba(216, 180, 254, 0.95)' : 'rgba(192, 132, 252, 0.7)'
      ring.style.boxShadow = hovering
        ? '0 0 22px rgba(168, 85, 247, 0.75)'
        : '0 0 14px rgba(168, 85, 247, 0.5)'
      dot.style.opacity = shown ? (hovering ? '0.4' : '1') : '0'
    }

    const show = () => {
      if (shown) return
      shown = true
      ring.style.opacity = '1'
      updateTarget()
    }

    const onMove = (e: MouseEvent) => {
      mx = e.clientX
      my = e.clientY
      dot.style.transform = `translate3d(${mx - 4}px, ${my - 4}px, 0)`
      const overInteractive = !!(e.target as Element | null)?.closest?.(INTERACTIVE)
      if (overInteractive !== hovering) {
        hovering = overInteractive
        updateTarget()
      }
      show()
    }
    const onDown = () => { pressed = true; updateTarget() }
    const onUp = () => { pressed = false; updateTarget() }
    const onLeave = () => {
      shown = false
      hovering = false
      pressed = false
      dot.style.opacity = '0'
      ring.style.opacity = '0'
    }

    const loop = () => {
      rx += (mx - rx) * 0.16
      ry += (my - ry) * 0.16
      scale += (scaleTarget - scale) * 0.2
      ring.style.transform = `translate3d(${rx - 18}px, ${ry - 18}px, 0) scale(${scale})`
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    document.addEventListener('mouseleave', onLeave)
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <>
      {/* Trailing ring */}
      <div
        ref={ringRef}
        aria-hidden
        className="fixed top-0 left-0 z-[60] h-9 w-9 rounded-full pointer-events-none opacity-0 transition-[opacity,border-color,box-shadow] duration-300"
        style={{
          border: '1.5px solid rgba(192, 132, 252, 0.7)',
          boxShadow: '0 0 14px rgba(168, 85, 247, 0.5)',
          willChange: 'transform',
        }}
      />
      {/* Core dot */}
      <div
        ref={dotRef}
        aria-hidden
        className="fixed top-0 left-0 z-[60] h-2 w-2 rounded-full pointer-events-none opacity-0 transition-opacity duration-300"
        style={{
          background: 'rgb(216, 180, 254)',
          boxShadow: '0 0 12px 3px rgba(168, 85, 247, 0.8)',
          willChange: 'transform',
        }}
      />
    </>
  )
}

export default CursorGlow

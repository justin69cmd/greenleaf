import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import VaporizeTextCycle, { Tag } from '@/components/ui/vapour-text-effect'

interface BootloaderProps {
  /** Called once the exit fade has fully completed. */
  onDone: () => void
  /** Total time the boot screen stays up before fading out (ms). */
  duration?: number
}

/**
 * Bootloader — a full-screen black intro that vaporizes "Equilibrium" into
 * "Agentic AI" over a thin progress bar, then dissolves into the app. Plays on
 * every page load. Falls back to a static title when reduced motion is on.
 */
export function Bootloader({ onDone, duration = 3600 }: BootloaderProps) {
  const reduceMotion = useReducedMotion()
  const total = reduceMotion ? 1500 : duration
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), total)
    return () => clearTimeout(t)
  }, [total])

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!exiting && (
        <motion.div
          key="boot"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        >
          <div className="w-full max-w-[540px] px-8">
            <div className="flex items-center justify-center" style={{ height: 120, width: '100%' }}>
              {reduceMotion ? (
                <h1 className="text-center text-5xl font-semibold tracking-tight text-white">
                  Equilibrium
                </h1>
              ) : (
                <VaporizeTextCycle
                  texts={['Equilibrium', 'Agentic AI']}
                  font={{ fontFamily: 'Geist, sans-serif', fontSize: '64px', fontWeight: 600 }}
                  color="rgb(245, 240, 255)"
                  spread={4}
                  density={6}
                  animation={{ vaporizeDuration: 1.4, fadeInDuration: 0.8, waitDuration: 0.6 }}
                  direction="left-to-right"
                  alignment="center"
                  tag={Tag.H1}
                />
              )}
            </div>

            {/* Thin progress bar */}
            <div className="mx-auto mt-2 h-[2px] w-full max-w-[300px] overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-400"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: total / 1000, ease: 'linear' }}
              />
            </div>
            <p className="mt-4 text-center text-[10px] font-medium uppercase tracking-[0.25em] text-white/40">
              Initializing
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default Bootloader

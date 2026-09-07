import { useEffect, useRef } from 'react'

// Six single-character boxes that behave like one field: typing advances,
// backspace retreats, and pasting a whole code fills every box at once.
export default function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  length = 6,
  autoFocus = true,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  length?: number
  autoFocus?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(length, ' ').slice(0, length).split('')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
    return clean
  }

  return (
    <div className="flex justify-center gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          value={digit.trim()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '')
            if (!typed) return
            // A fast typist (or an autofilled code) can land several characters
            // in one box, so spread whatever arrived across the boxes from here.
            const incoming = typed.length > 1 && typed[0] === digit.trim() ? typed.slice(1) : typed
            const chars = value.padEnd(length, ' ').split('')
            let slot = i
            for (const ch of incoming) {
              if (slot >= length) break
              chars[slot++] = ch
            }
            const clean = set(chars.join('').replace(/\s/g, ''))
            refs.current[Math.min(clean.length, length - 1)]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              const chars = value.split('')
              if (chars[i]) chars[i] = ''
              else if (i > 0) {
                chars[i - 1] = ''
                refs.current[i - 1]?.focus()
              }
              onChange(chars.join('').replace(/\s/g, ''))
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
            if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus()
          }}
          onPaste={(e) => {
            e.preventDefault()
            const clean = set(e.clipboardData.getData('text'))
            refs.current[Math.min(clean.length, length - 1)]?.focus()
          }}
          className="h-12 w-11 rounded-xl border border-white/10 bg-white/5 text-center font-mono text-lg text-white outline-none transition-colors focus:border-emerald-400/60 disabled:opacity-40"
        />
      ))}
    </div>
  )
}

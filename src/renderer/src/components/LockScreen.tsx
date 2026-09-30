import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Delete, Lock } from 'lucide-react'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'

const PIN_LENGTH = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const

export function LockScreen(): JSX.Element {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)

  const press = useCallback(
    async (key: string) => {
      if (busy) return
      if (key === 'clear') { setPin(''); return }
      if (key === 'back') { setPin((p) => p.slice(0, -1)); return }
      if (pin.length >= PIN_LENGTH) return
      const next = pin + key
      setPin(next)
      setError(false)
      if (next.length === PIN_LENGTH) {
        setBusy(true)
        const ok = await window.api.pinVerify(next).catch(() => false)
        if (ok) {
          await useApp.getState().enterApp()
        } else {
          setError(true)
          setShake((n) => n + 1)
          setTimeout(() => setPin(''), 260)
        }
        setBusy(false)
      }
    },
    [pin, busy]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (/^\d$/.test(e.key)) void press(e.key)
      else if (e.key === 'Backspace') void press('back')
      else if (e.key === 'Escape') void press('clear')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  return (
    <motion.section
      className="absolute inset-0 z-30 flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
    >
      <motion.div
        key={shake}
        animate={shake ? { x: [0, -14, 12, -9, 6, 0] } : undefined}
        transition={{ duration: 0.36 }}
        className="flex w-72 flex-col items-center gap-5 rounded-2xl border bg-card p-8 shadow-xl"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Enter PIN</h1>

        <div className="flex gap-3" aria-label="PIN entry">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <motion.span
              key={i}
              animate={{ scale: i < pin.length ? 1.15 : 1 }}
              className={cn(
                'h-3 w-3 rounded-full border-2 transition-colors',
                i < pin.length ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                error && 'border-destructive bg-destructive'
              )}
            />
          ))}
        </div>
        <div className="h-4 text-xs text-destructive">{error ? 'Incorrect PIN' : ''}</div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <motion.button
              key={k}
              whileTap={{ scale: 0.9 }}
              onClick={() => void press(k)}
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-full text-lg font-medium transition-colors',
                k === 'clear' || k === 'back'
                  ? 'text-xs text-muted-foreground hover:bg-accent'
                  : 'bg-secondary hover:bg-accent'
              )}
            >
              {k === 'clear' ? 'Clear' : k === 'back' ? <Delete className="h-5 w-5" /> : k}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.section>
  )
}

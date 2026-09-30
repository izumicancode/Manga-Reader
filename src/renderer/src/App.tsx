import { useEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useApp } from '@/store'
import { hexToHslTriplet } from '@/lib/color'
import { Toaster } from '@/components/ui/sonner'
import { LockScreen } from '@/components/LockScreen'
import { TopBar } from '@/components/TopBar'
import { LibraryView } from '@/components/LibraryView'
import { HistoryView } from '@/components/HistoryView'
import { SettingsView } from '@/components/SettingsView'
import { Reader } from '@/components/Reader'

const CARD_WIDTH = { small: '120px', medium: '160px', large: '210px' } as const

function useAppearance(): void {
  const { theme, accentColor, cardSize } = useApp((s) => s.settings)
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    const { hsl, foreground } = hexToHslTriplet(accentColor)
    root.style.setProperty('--primary', hsl)
    root.style.setProperty('--ring', hsl)
    root.style.setProperty('--primary-foreground', foreground)
    root.style.setProperty('--card-w', CARD_WIDTH[cardSize])
  }, [theme, accentColor, cardSize])
}

export default function App(): JSX.Element {
  const phase = useApp((s) => s.phase)
  const tab = useApp((s) => s.tab)
  const reader = useApp((s) => s.reader)
  const animations = useApp((s) => s.settings.animationsEnabled)
  const theme = useApp((s) => s.settings.theme)
  useAppearance()

  useEffect(() => {
    void useApp.getState().boot()
  }, [])

  return (
    // reducedMotion="user" honours the OS setting; the in-app toggle zeroes all durations.
    <MotionConfig reducedMotion="user" transition={animations ? undefined : { duration: 0 }}>
      <div className="relative h-full overflow-hidden bg-background">
        <AnimatePresence mode="wait">
          {phase === 'locked' && <LockScreen key="lock" />}
        </AnimatePresence>

        {phase === 'ready' && (
          <div className="flex h-full flex-col">
            <TopBar />
            <main className="relative min-h-0 flex-1 overflow-y-auto">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="min-h-full"
                >
                  {tab === 'library' && <LibraryView />}
                  {tab === 'history' && <HistoryView />}
                  {tab === 'settings' && <SettingsView />}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )}

        <AnimatePresence>{reader && <Reader key={reader.book.id} session={reader} />}</AnimatePresence>
      </div>
      <Toaster theme={theme} position="bottom-center" />
    </MotionConfig>
  )
}

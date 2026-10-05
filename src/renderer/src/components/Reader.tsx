import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import {
  ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Columns2, Maximize, Minimize,
  Minus, Plus, Scaling, Square
} from 'lucide-react'
import { useApp, type ReaderSession } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FitMode } from '@shared/types'

const FIT_CYCLE: FitMode[] = ['contain', 'width', 'height', 'original']
const FIT_LABELS: Record<FitMode, string> = { contain: 'Page', width: 'Width', height: 'Height', original: 'Original' }
const PRELOAD_AHEAD = 2
const PRELOAD_BEHIND = 1

const FIT_CLASS: Record<FitMode, string> = {
  contain: 'max-h-full max-w-full object-contain',
  width: 'w-full h-auto max-w-none',
  height: 'h-full w-auto max-w-none',
  original: 'max-w-none max-h-none'
}

export function Reader({ session }: { session: ReaderSession }): JSX.Element {
  const { book, pages } = session
  const settings = useApp((s) => s.settings)
  const closeReader = useApp((s) => s.closeReader)
  const rtl = settings.readingDirection === 'rtl'

  const [index, setIndex] = useState(session.resumePage)
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = back; drives slide direction
  const [fit, setFit] = useState<FitMode>(settings.defaultFit)
  const [zoom, setZoom] = useState(1)
  const [spread, setSpread] = useState(false)
  const [bookmarks, setBookmarks] = useState(session.bookmarks)
  const [toolbar, setToolbar] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()
  const preloaded = useRef(new Set<string>())

  const urlFor = useCallback(
    (i: number) => (i < 0 || i >= pages.length ? null : window.api.pageUrl(book.id, book.sourceVersion, pages[i])),
    [book.id, book.sourceVersion, pages]
  )

  // ---- toolbar visibility ----
  const showToolbar = useCallback(() => {
    setToolbar(true)
    clearTimeout(hideTimer.current)
    const { toolbarAutoHide, toolbarHideDelay } = useApp.getState().settings
    if (toolbarAutoHide) hideTimer.current = setTimeout(() => setToolbar(false), toolbarHideDelay)
  }, [])
  useEffect(() => { showToolbar(); return () => clearTimeout(hideTimer.current) }, [showToolbar])

  // ---- navigation ----
  const step = spread ? 2 : 1
  const go = useCallback((dir: 1 | -1) => {
    setDirection(dir)
    setIndex((i) => Math.min(Math.max(i + dir * step, 0), pages.length - 1))
  }, [step, pages.length])

  // Reading direction decides which physical side means "forward".
  const turn = useCallback((side: 'left' | 'right') => go((side === 'right') !== rtl ? 1 : -1), [go, rtl])

  // ---- persistence + read-ahead prefetch ----
  useEffect(() => {
    void window.api.saveProgress(book.id, index, (index + 1) / pages.length)
    for (let i = Math.max(0, index - PRELOAD_BEHIND); i <= Math.min(pages.length - 1, index + PRELOAD_AHEAD + (spread ? 1 : 0)); i++) {
      const url = urlFor(i)
      if (!url || preloaded.current.has(url)) continue
      preloaded.current.add(url)
      const img = new Image()
      img.decoding = 'async'
      img.src = url
    }
  }, [index, spread, book.id, pages.length, urlFor])

  // ---- actions ----
  const cycleFit = useCallback(() => setFit((f) => FIT_CYCLE[(FIT_CYCLE.indexOf(f) + 1) % FIT_CYCLE.length]), [])
  const changeZoom = useCallback((d: number) => setZoom((z) => Math.min(3, Math.max(0.5, Math.round((z + d) * 10) / 10))), [])
  const bookmarked = bookmarks.includes(index)
  const toggleBookmark = useCallback(async () => {
    const added = await window.api.toggleBookmark(book.id, index)
    setBookmarks((b) => (added ? [...b, index].sort((x, y) => x - y) : b.filter((p) => p !== index)))
  }, [book.id, index])
  const toggleFullscreen = useCallback(async () => setFullscreen(await window.api.toggleFullscreen()), [])

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (k === 'arrowright' || k === 'd') turn('right')
      else if (k === 'arrowleft' || k === 'a') turn('left')
      else if (k === 't') { if (toolbar) { clearTimeout(hideTimer.current); setToolbar(false) } else showToolbar(); return }
      else if (k === 'f' && e.ctrlKey && e.shiftKey) { e.preventDefault(); void toggleFullscreen() }
      else if (k === 'f') cycleFit()
      else if (k === '+' || k === '=') changeZoom(0.1)
      else if (k === '-') changeZoom(-0.1)
      else if (k === 'b') void toggleBookmark()
      else if (k === 's') setSpread((v) => !v)
      else if (e.key === 'Escape') { if (fullscreen) void toggleFullscreen(); else closeReader() }
      else return
      showToolbar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, toolbar, showToolbar, cycleFit, changeZoom, toggleBookmark, toggleFullscreen, closeReader, fullscreen])

  // Leave window fullscreen if the reader closes while in it.
  const fullscreenRef = useRef(false)
  useEffect(() => { fullscreenRef.current = fullscreen }, [fullscreen])
  useEffect(() => () => { if (fullscreenRef.current) void window.api.toggleFullscreen() }, [])

  // ---- swipe (drag) ----
  const onDragEnd = (_: unknown, info: PanInfo): void => {
    const { x } = info.offset
    if (Math.abs(x) < 70 && Math.abs(info.velocity.x) < 500) return
    turn(x < 0 ? 'right' : 'left') // dragging left reveals the "right" page, like turning a physical page
  }

  const spreadPages = useMemo(() => {
    const second = spread ? urlFor(index + 1) : null
    const first = urlFor(index)
    // In RTL spreads the first page sits on the right.
    return second ? (rtl ? [second, first!] : [first!, second]) : [first!]
  }, [index, spread, rtl, urlFor])

  const slide = { enter: (d: number) => ({ x: d * 60, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -60, opacity: 0 }) }

  return (
    <motion.section
      className={cn('absolute inset-0 z-40 overflow-hidden bg-black text-white', !toolbar && 'cursor-none')}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      onMouseMove={showToolbar}
    >
      {/* page area */}
      <div className="absolute inset-0 overflow-auto">
        <div className="flex min-h-full min-w-full items-center justify-center">
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            <motion.div
              key={`${index}-${spread}`}
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: 'easeOut' }}
              drag={zoom === 1 && fit !== 'original' ? 'x' : false}
              dragSnapToOrigin
              dragElastic={0.25}
              onDragEnd={onDragEnd}
              className={cn('flex items-center justify-center', fit === 'contain' || fit === 'height' ? 'h-screen' : 'w-full')}
              style={{ scale: zoom }}
            >
              {spreadPages.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  decoding="async"
                  draggable={false}
                  className={cn('select-none', FIT_CLASS[fit], spread && spreadPages.length > 1 && 'max-w-[50%]')}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* invisible click zones for quick page turning */}
      <button aria-label="Previous side" className="absolute inset-y-16 left-0 z-10 w-[18%] cursor-w-resize opacity-0" onClick={() => turn('left')} />
      <button aria-label="Next side" className="absolute inset-y-16 right-0 z-10 w-[18%] cursor-e-resize opacity-0" onClick={() => turn('right')} />

      {/* thin progress line always visible */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/10">
        <motion.div className="h-full bg-primary" animate={{ width: `${((index + 1) / pages.length) * 100}%` }} transition={{ duration: 0.25 }} />
      </div>

      {/* toolbar */}
      <AnimatePresence>
        {toolbar && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-white/10 bg-black/75 px-4 py-2.5 backdrop-blur-xl"
          >
            <Button variant="overlay" size="sm" onClick={closeReader}><ArrowLeft /> Library</Button>
            <div className="min-w-0 flex-1 truncate text-sm font-medium" title={book.title}>{book.title}</div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="overlay" size="sm" onClick={() => turn('left')}><ChevronLeft /></Button>
              <span className="min-w-16 text-center text-xs tabular-nums text-white/80">{index + 1} / {pages.length}</span>
              <Button variant="overlay" size="sm" onClick={() => turn('right')}><ChevronRight /></Button>
              <span className="mx-1 h-5 w-px bg-white/15" />
              <Button variant="overlay" size="sm" onClick={cycleFit} title="Cycle fit mode (F)"><Scaling /> {FIT_LABELS[fit]}</Button>
              <Button variant="overlay" size="sm" onClick={() => changeZoom(-0.1)} title="Zoom out (−)"><Minus /></Button>
              <span className="w-10 text-center text-xs tabular-nums text-white/80">{Math.round(zoom * 100)}%</span>
              <Button variant="overlay" size="sm" onClick={() => changeZoom(0.1)} title="Zoom in (+)"><Plus /></Button>
              <span className="mx-1 h-5 w-px bg-white/15" />
              <Button variant="overlay" size="sm" onClick={() => void toggleBookmark()} title="Bookmark page (B)" className={cn(bookmarked && 'text-primary')}>
                {bookmarked ? <BookmarkCheck /> : <Bookmark />}
              </Button>
              <Button variant="overlay" size="sm" onClick={() => setSpread((v) => !v)} title="Toggle double-page view (S)">
                {spread ? <Square /> : <Columns2 />}
              </Button>
              <Button variant="overlay" size="sm" onClick={() => void toggleFullscreen()} title="Fullscreen (Ctrl+Shift+F)">
                {fullscreen ? <Minimize /> : <Maximize />}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

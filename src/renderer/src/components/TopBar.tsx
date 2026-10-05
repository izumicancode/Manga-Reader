import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Library, History as HistoryIcon, Settings as SettingsIcon, Search, BookMarked } from 'lucide-react'
import { useApp, type SortKey, type StatusFilter, type Tab } from '@/store'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const TABS: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'history', label: 'Continue Reading', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

const TONE_DOT = { neutral: 'bg-muted-foreground', active: 'bg-primary animate-pulse', success: 'bg-success' } as const

export function TopBar(): JSX.Element {
  const { tab, setTab, books, status, search, category, statusFilter, sort, setFilter } = useApp()
  const searchRef = useRef<HTMLInputElement>(null)
  const categories = [...new Set(books.map((b) => b.category || 'Uncategorized'))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const mac = window.api.platform === 'darwin'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || useApp.getState().reader) return
      event.preventDefault()
      setTab('library')
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTab])

  return (
    <header className={cn('drag-region shrink-0 border-b bg-card/70 backdrop-blur-xl', mac && 'pt-2')}>
      <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3', mac && 'pl-24')}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <BookMarked className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Manga Library</div>
            <div className="text-xs text-muted-foreground">Local collection</div>
          </div>
        </div>

        <div role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[status.tone])} />
          {status.text}
        </div>

        <nav className="no-drag flex items-center gap-1 rounded-lg bg-muted p-1" aria-label="Main navigation">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === id ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab === id && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-md bg-primary shadow"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </nav>

        <div className="no-drag ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setFilter({ search: e.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && search) {
                  event.preventDefault()
                  setFilter({ search: '' })
                }
              }}
              placeholder="Search titles…"
              aria-label="Search titles"
              className="w-52 pl-8"
            />
          </div>
          <Select value={category} onValueChange={(v) => setFilter({ category: v })}>
            <SelectTrigger className="w-40" aria-label="Filter by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setFilter({ statusFilter: v as StatusFilter })}>
            <SelectTrigger className="w-32" aria-label="Filter by reading status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All titles</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="favorites">Favorites</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setFilter({ sort: v as SortKey })}>
            <SelectTrigger className="w-36" aria-label="Sort library"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="recent">Recently read</SelectItem>
              <SelectItem value="progress">Progress</SelectItem>
              <SelectItem value="favorites">Favorites</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  )
}

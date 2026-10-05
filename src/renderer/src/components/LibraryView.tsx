import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, SearchX } from 'lucide-react'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { BookCard } from '@/components/BookCard'

export function EmptyState({ icon, title, message, action }: {
  icon: JSX.Element; title: string; message: string; action?: JSX.Element
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary"
      >
        {icon}
      </motion.div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </motion.div>
  )
}

export function BookGrid({ ids }: { ids: string[] }): JSX.Element {
  const books = useApp((s) => s.books)
  const history = useApp((s) => s.history)
  const openReader = useApp((s) => s.openReader)
  const toggleFavorite = useApp((s) => s.toggleFavorite)
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])

  return (
    <div
      className="grid gap-x-5 gap-y-7 p-6"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-w), 1fr))' }}
    >
      {ids.map((id, i) => {
        const book = byId.get(id)
        return book ? (
          <BookCard key={id} book={book} history={history[id]} index={i} onOpen={openReader} onFavorite={toggleFavorite} />
        ) : null
      })}
    </div>
  )
}

export function LibraryView(): JSX.Element {
  const { books, history, settings, search, category, statusFilter, sort, pickFolder, refreshLibrary } = useApp()

  const ids = useMemo(() => {
    const q = search.trim().toLowerCase()
    return books
      .filter((b) => {
        if (q && ![b.title, b.category].some((field) => field.toLowerCase().includes(q))) return false
        if (category !== 'all' && (b.category || 'Uncategorized') !== category) return false
        if (statusFilter === 'favorites' && !b.favorite) return false
        if (statusFilter === 'unread' && history[b.id]) return false
        return true
      })
      .sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
        if (sort === 'favorites') return Number(b.favorite) - Number(a.favorite) || byTitle
        if (sort === 'progress') return (history[b.id]?.percent || 0) - (history[a.id]?.percent || 0) || byTitle
        if (sort === 'recent') return (history[b.id]?.lastReadAt || 0) - (history[a.id]?.lastReadAt || 0) || byTitle
        return byTitle
      })
      .map((b) => b.id)
  }, [books, history, search, category, statusFilter, sort])

  if (!books.length) {
    const hasFolder = Boolean(settings.libraryFolder)
    return (
      <EmptyState
        icon={<FolderOpen className="h-8 w-8" />}
        title={hasFolder ? 'No readable titles found' : 'Your library is ready'}
        message={hasFolder
          ? 'The selected folder has no readable manga yet. Add image files or supported archives, then rescan.'
          : 'Choose the folder that contains your manga. Subfolders and ZIP, CBZ, RAR, and CBR files are supported.'}
        action={hasFolder
          ? <Button onClick={() => void refreshLibrary()}>Rescan Library</Button>
          : <Button onClick={() => void pickFolder()}>Choose Library Folder</Button>}
      />
    )
  }
  if (!ids.length) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" />}
        title="No titles match these filters"
        message="Try a different search, category, or reading status."
      />
    )
  }
  return <BookGrid ids={ids} />
}

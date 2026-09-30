import { useMemo } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { useApp } from '@/store'
import { BookGrid, EmptyState } from '@/components/LibraryView'

export function HistoryView(): JSX.Element {
  const books = useApp((s) => s.books)
  const history = useApp((s) => s.history)

  const ids = useMemo(() => {
    const known = new Set(books.map((b) => b.id))
    return Object.entries(history)
      .filter(([id, h]) => known.has(id) && h.lastReadAt)
      .sort((a, b) => (b[1].lastReadAt || 0) - (a[1].lastReadAt || 0))
      .map(([id]) => id)
  }, [books, history])

  if (!ids.length) {
    return (
      <EmptyState
        icon={<HistoryIcon className="h-8 w-8" />}
        title="Nothing here yet"
        message="You haven't started reading anything yet."
      />
    )
  }
  return <BookGrid ids={ids} />
}

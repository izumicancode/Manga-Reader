import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Star } from 'lucide-react'
import type { Book, HistoryEntry } from '@shared/types'
import { cn } from '@/lib/utils'

interface Props {
  book: Book
  history?: HistoryEntry
  index: number
  onOpen: (id: string) => void
  onFavorite: (book: Book) => void
}

export const BookCard = memo(function BookCard({ book, history, index, onOpen, onFavorite }: Props): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const percent = history ? Math.round((history.percent || 0) * 100) : 0
  const isNew = !history
  const showImage = book.cover && !failed

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 18) * 0.025 }}
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onOpen(book.id)}
      className="group cursor-pointer"
    >
      {/* content-visibility keeps off-screen cards free to lay out and paint */}
      <div className="[content-visibility:auto] [contain-intrinsic-size:auto_300px]">
        <div className="relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted transition-shadow group-hover:ring-2 group-hover:ring-primary/60">
          {showImage ? (
            <img
              src={window.api.coverUrl(book.id, book.mtimeMs)}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={cn(
                'h-full w-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-105',
                loaded ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <BookOpen className="h-8 w-8" />
            </div>
          )}

          <button
            title={book.favorite ? 'Remove favorite' : 'Add favorite'}
            onClick={(e) => { e.stopPropagation(); onFavorite(book) }}
            className={cn(
              'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur transition-opacity hover:bg-black/75',
              book.favorite ? 'text-yellow-400 opacity-100' : 'text-white opacity-0 group-hover:opacity-100'
            )}
          >
            <motion.span whileTap={{ scale: 1.4 }} className="flex">
              <Star className="h-4 w-4" fill={book.favorite ? 'currentColor' : 'none'} />
            </motion.span>
          </button>

          {isNew && (
            <div className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-foreground">
              NEW
            </div>
          )}

          {percent > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <motion.div
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.6, delay: 0.15 }}
              />
            </div>
          )}
        </div>

        <div className="mt-2 line-clamp-2 text-sm font-medium leading-snug" title={book.title}>{book.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {book.pageCount} page{book.pageCount === 1 ? '' : 's'} · {book.category || 'Uncategorized'}
          {percent ? ` · ${percent}%` : ''}
        </div>
      </div>
    </motion.div>
  )
})

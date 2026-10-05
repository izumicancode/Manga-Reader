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
  const savedProgress = history?.percent
  const progress = typeof savedProgress === 'number' && Number.isFinite(savedProgress)
    ? Math.min(1, Math.max(0, savedProgress))
    : 0
  const percent = Math.round(progress * 100)
  const isNew = !history
  const showImage = book.cover && !failed

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 18) * 0.025 }}
      className="group"
    >
      {/* content-visibility keeps off-screen cards free to lay out and paint */}
      <div className="[content-visibility:auto] [contain-intrinsic-size:auto_300px]">
        <div className="relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted transition-shadow group-hover:ring-2 group-hover:ring-primary/60">
          <button type="button" aria-label={`Open ${book.title}`} onClick={() => onOpen(book.id)} className="absolute inset-0 h-full w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
            {showImage ? (
              <img
                src={window.api.coverUrl(book.id, book.sourceVersion)}
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
          </button>

          <button
            type="button"
            aria-label={book.favorite ? `Remove ${book.title} from favorites` : `Add ${book.title} to favorites`}
            aria-pressed={book.favorite}
            title={book.favorite ? 'Remove favorite' : 'Add favorite'}
            onClick={(e) => { e.stopPropagation(); onFavorite(book) }}
            className={cn(
              'absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-opacity hover:bg-black/85 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
              book.favorite ? 'text-yellow-400 opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
            )}
          >
            <motion.span whileTap={{ scale: 1.4 }} className="flex">
              <Star className="h-4 w-4" fill={book.favorite ? 'currentColor' : 'none'} />
            </motion.span>
          </button>

        </div>

        <button type="button" onClick={() => onOpen(book.id)} className="mt-2 line-clamp-2 text-left text-sm font-medium leading-snug focus-visible:outline-none focus-visible:underline" title={book.title}>
          {book.title}
        </button>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {book.pageCount} page{book.pageCount === 1 ? '' : 's'} · {book.category || 'Uncategorized'}
          {percent ? ` · ${percent}%` : ''}
        </div>
      </div>
    </motion.article>
  )
})

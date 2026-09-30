export type Theme = 'dark' | 'light'
export type CardSize = 'small' | 'medium' | 'large'
export type ReadingDirection = 'ltr' | 'rtl'
export type FitMode = 'contain' | 'width' | 'height' | 'original'
export type SourceType = 'folder' | 'image' | 'archive'

export interface Prefs {
  theme: Theme
  accentColor: string
  cardSize: CardSize
  readingDirection: ReadingDirection
  defaultFit: FitMode
  toolbarAutoHide: boolean
  toolbarHideDelay: number
  animationsEnabled: boolean
}

export interface Settings extends Prefs {
  libraryFolder: string | null
  pinEnabled: boolean
}

export interface Book {
  id: string
  title: string
  category: string
  type: SourceType
  filePath: string
  cover: string | null
  pageCount: number
  favorite: boolean
  tags: string[]
  mtimeMs: number
  sizeBytes: number
}

export interface HistoryEntry {
  page?: number
  percent?: number
  lastReadAt?: number
  bookmarks?: number[]
}
export type History = Record<string, HistoryEntry>

export interface ScanResult {
  books: Book[]
  error: string | null
  skipped?: string[]
}

export type OpenBookResult =
  | { error: string }
  | { error: null; book: Book; pages: string[]; resumePage: number; bookmarks: number[] }

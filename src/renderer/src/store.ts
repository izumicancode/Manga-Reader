import { create } from 'zustand'
import { toast } from 'sonner'
import { DEFAULT_PREFS } from '@shared/constants'
import type { Book, History, Prefs, Settings } from '@shared/types'

export type Tab = 'library' | 'history' | 'settings'
export type StatusFilter = 'all' | 'unread' | 'favorites'
export type SortKey = 'title' | 'recent' | 'progress' | 'favorites'
export type StatusTone = 'neutral' | 'active' | 'success'

export interface ReaderSession {
  book: Book
  pages: string[]
  resumePage: number
  bookmarks: number[]
}

const FALLBACK_SETTINGS: Settings = { ...DEFAULT_PREFS, libraryFolder: null, pinEnabled: false }
const settingWriteIds = new Map<keyof Prefs, number>()
let removeLibraryChangedListener: (() => void) | undefined
let libraryRefreshId = 0

const OPEN_ERRORS: Record<string, string> = {
  'missing-file': 'That file no longer exists on disk. Try rescanning your library.',
  'no-pages': "This archive doesn't contain any readable images.",
  'read-failed': "That file couldn't be read — it may be corrupted."
}

async function safe<T>(p: Promise<T>, fallback: T, message?: string): Promise<T> {
  try {
    return await p
  } catch (err) {
    console.error(message ?? '[ipc error]', err)
    if (message) toast.error(message)
    return fallback
  }
}

interface AppState {
  phase: 'booting' | 'locked' | 'ready'
  tab: Tab
  books: Book[]
  history: History
  settings: Settings
  status: { text: string; tone: StatusTone }
  search: string
  category: string
  statusFilter: StatusFilter
  sort: SortKey
  reader: ReaderSession | null

  boot: () => Promise<void>
  enterApp: () => Promise<void>
  setTab: (tab: Tab) => void
  setFilter: (patch: Partial<Pick<AppState, 'search' | 'category' | 'statusFilter' | 'sort'>>) => void
  refreshLibrary: (opts?: { quiet?: boolean }) => Promise<void>
  refreshHistory: () => Promise<void>
  pickFolder: () => Promise<void>
  toggleFavorite: (book: Book) => Promise<void>
  clearHistory: () => Promise<boolean>
  updateSetting: <K extends keyof Prefs>(key: K, value: Prefs[K]) => Promise<void>
  resetSettings: () => Promise<void>
  setPinEnabled: (enabled: boolean) => void
  openReader: (bookId: string) => Promise<void>
  closeReader: () => void
}

export const useApp = create<AppState>((set, get) => ({
  phase: 'booting',
  tab: 'library',
  books: [],
  history: {},
  settings: FALLBACK_SETTINGS,
  status: { text: 'Ready', tone: 'neutral' },
  search: '',
  category: 'all',
  statusFilter: 'all',
  sort: 'title',
  reader: null,

  boot: async () => {
    const settings = await safe(window.api.getSettings(), FALLBACK_SETTINGS)
    set({ settings: { ...FALLBACK_SETTINGS, ...settings } })
    const pin = await safe(window.api.pinStatus(), { enabled: false })
    if (pin.enabled) set({ phase: 'locked' })
    else await get().enterApp()
  },

  enterApp: async () => {
    const settings = await safe(window.api.getSettings(), get().settings)
    set({ settings: { ...FALLBACK_SETTINGS, ...settings }, phase: 'ready' })
    removeLibraryChangedListener?.()
    removeLibraryChangedListener = window.api.onLibraryChanged(() => {
      toast('Library changes detected. Refreshing…')
      void get().refreshLibrary({ quiet: true })
    })
    await get().refreshLibrary()
  },

  setTab: (tab) => {
    set({ tab })
    if (tab === 'history') void get().refreshHistory()
  },

  setFilter: (patch) => set(patch),

  refreshLibrary: async ({ quiet = false } = {}) => {
    const refreshId = ++libraryRefreshId
    set({ status: { text: quiet ? 'Refreshing…' : 'Scanning library…', tone: 'active' } })
    const res = await safe(window.api.scanLibrary(), null, 'Could not scan your library folder.')
    const books = res ? res.books : await safe(window.api.getLibrary(), [], 'Could not load your library.')
    if (refreshId !== libraryRefreshId) return
    if (res?.skipped?.length) toast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`)
    const history = await safe(window.api.getHistory(), get().history)
    if (refreshId !== libraryRefreshId) return
    const categories = new Set(books.map((b) => b.category || 'Uncategorized'))
    set({
      books,
      history,
      category: categories.has(get().category) ? get().category : 'all',
      status: { text: `${books.length} titles loaded`, tone: books.length ? 'success' : 'neutral' }
    })
  },

  refreshHistory: async () => {
    set({ history: await safe(window.api.getHistory(), get().history, 'Could not load reading history.') })
  },

  pickFolder: async () => {
    const folder = await safe(window.api.chooseLibraryFolder(), null, "Couldn't choose a library folder.")
    if (!folder) return
    set({ settings: { ...get().settings, libraryFolder: folder } })
    await get().refreshLibrary()
  },

  toggleFavorite: async (book) => {
    const favorite = await safe(window.api.toggleFavorite(book.id), null)
    if (favorite === null) {
      toast.error("Couldn't update favorite.")
      return
    }
    set({ books: get().books.map((b) => (b.id === book.id ? { ...b, favorite } : b)) })
  },

  clearHistory: async () => {
    const previous = get().history
    set({ history: {} })
    const cleared = await safe(window.api.clearHistory(), false, "Couldn't clear history.")
    if (!cleared) set({ history: previous })
    return cleared
  },

  updateSetting: async (key, value) => {
    const previous = get().settings[key]
    const writeId = (settingWriteIds.get(key) ?? 0) + 1
    settingWriteIds.set(key, writeId)
    set({ settings: { ...get().settings, [key]: value } }) // optimistic
    const ok = await safe(window.api.setSetting(key, value), false, "Couldn't save that setting.")
    if (!ok && settingWriteIds.get(key) === writeId) {
      set({ settings: { ...get().settings, [key]: previous } })
    }
  },

  resetSettings: async () => {
    const defaults = await safe(window.api.resetSettings(), null, "Couldn't reset settings.")
    if (defaults) {
      set({ settings: { ...get().settings, ...defaults } })
      toast.success('Settings reset to defaults.')
    }
  },

  setPinEnabled: (enabled) => set({ settings: { ...get().settings, pinEnabled: enabled } }),

  openReader: async (bookId) => {
    const opened = await safe(window.api.openBook(bookId), { error: 'ipc-failed' as const }, "Couldn't open that book.")
    if (opened.error !== null) {
      toast.error(OPEN_ERRORS[opened.error] ?? "Couldn't open that book.")
      return
    }
    set({ reader: { book: opened.book, pages: opened.pages, resumePage: opened.resumePage, bookmarks: opened.bookmarks } })
  },

  closeReader: () => {
    set({ reader: null })
    void get().refreshHistory()
  }
}))

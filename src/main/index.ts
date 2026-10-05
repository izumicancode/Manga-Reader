import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import * as unrar from 'node-unrar-js'
import Store from 'electron-store'
import { DEFAULT_PREFS, PREF_KEYS } from '../shared/constants'
import type { Book, History, HistoryEntry, OpenBookResult, Prefs, ScanResult, SourceType } from '../shared/types'

const fsp = fs.promises

// Custom schemes must be registered before app is ready. Covers and pages are
// streamed straight to <img> tags instead of base64-ing them through IPC.
protocol.registerSchemesAsPrivileged([
  { scheme: 'page', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

process.on('uncaughtException', (err) => console.error('[main] uncaughtException:', err))
process.on('unhandledRejection', (err) => console.error('[main] unhandledRejection:', err))

// ---------- state ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: Store<any>, libraryStore: Store<any>, historyStore: Store<any>
let mainWindow: BrowserWindow | null = null
let fsWatcher: fs.FSWatcher | null = null
let fallbackPollTimer: NodeJS.Timeout | null = null
let watchDebounceTimer: NodeJS.Timeout | undefined
let lastLibrarySignature = ''
let signatureRequestId = 0
let libraryScanId = 0

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
const ARCHIVE_EXT = new Set(['.cbz', '.zip', '.cbr', '.rar'])
const RAR_EXT = new Set(['.cbr', '.rar'])
const MAX_PAGE_CACHE_BYTES = 128 * 1024 * 1024

interface RarEntry { pages: string[]; content: Map<string, Buffer> }
const rarCache = new Map<string, RarEntry>()
const zipEntryCache = new Map<string, Map<string, AdmZip.IZipEntry>>()
const pageBinaryCache = new Map<string, Buffer>()

const ext = (p: string): string => path.extname(p).toLowerCase()
const isImage = (p: string): boolean => IMAGE_EXT.has(ext(p))
const naturalSort = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

const thumbDir = (): string => {
  const dir = path.join(app.getPath('userData'), 'thumbnails')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}
const hashId = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

function getBook(bookId: unknown): Book | undefined {
  if (typeof bookId !== 'string' || !/^[a-f0-9]{16}$/.test(bookId)) return undefined
  return libraryStore.get(`books.${bookId}`) as Book | undefined
}

function trimMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function trimBufferMap(map: Map<string, Buffer>, maxBytes: number): void {
  let totalBytes = [...map.values()].reduce((total, buffer) => total + buffer.byteLength, 0)
  while (totalBytes > maxBytes) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    totalBytes -= map.get(oldest)?.byteLength ?? 0
    map.delete(oldest)
  }
}

// ---------- scanning ----------
async function findLibrarySources(rootDir: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[]
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        let children: fs.Dirent[] = []
        try { children = await fsp.readdir(full, { withFileTypes: true }) } catch { /* unreadable */ }
        if (children.some((c) => c.isFile() && isImage(c.name))) results.push(full)
        else await walk(full)
      } else if (entry.isFile() && (ARCHIVE_EXT.has(ext(entry.name)) || isImage(entry.name))) {
        results.push(full)
      }
    }
  }
  await walk(rootDir)
  return results
}

async function librarySignature(rootDir: string): Promise<string> {
  const files = await findLibrarySources(rootDir)
  const parts = await Promise.all(files.map(async (f) => {
    try {
      const stat = await fsp.stat(f)
      const type = sourceType(f, stat)
      return `${f}:${type ? await sourceVersion(f, type) : 'unsupported'}`
    } catch { return `${f}:missing` }
  }))
  return parts.sort().join('|')
}

function stopWatching(): void {
  signatureRequestId += 1
  if (fsWatcher) { try { fsWatcher.close() } catch { /* closed */ } fsWatcher = null }
  if (fallbackPollTimer) clearInterval(fallbackPollTimer)
  fallbackPollTimer = null
  clearTimeout(watchDebounceTimer)
}

async function notifyIfLibraryChanged(folder: string): Promise<void> {
  const requestId = ++signatureRequestId
  const signature = await librarySignature(folder)
  if (requestId !== signatureRequestId) return
  if (!lastLibrarySignature) { lastLibrarySignature = signature; return }
  if (signature === lastLibrarySignature) return
  lastLibrarySignature = signature
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('library-changed')
}

function startLibraryWatcher(): void {
  stopWatching()
  lastLibrarySignature = ''
  const folder = store?.get('libraryFolder') as string | undefined
  if (!folder || !fs.existsSync(folder)) return
  void notifyIfLibraryChanged(folder) // prime the baseline signature

  const onChange = (): void => {
    clearTimeout(watchDebounceTimer)
    watchDebounceTimer = setTimeout(() => void notifyIfLibraryChanged(folder), 800)
  }
  const startPolling = (): void => {
    fallbackPollTimer = setInterval(() => void notifyIfLibraryChanged(folder), 8000)
  }
  try {
    fsWatcher = fs.watch(folder, { recursive: true }, onChange)
    fsWatcher.on('error', () => { stopWatching(); startPolling() })
  } catch {
    startPolling()
  }
}

function sourceType(filePath: string, stat?: fs.Stats): SourceType | null {
  if ((stat ?? fs.statSync(filePath)).isDirectory()) return 'folder'
  if (isImage(filePath)) return 'image'
  if (ARCHIVE_EXT.has(ext(filePath))) return 'archive'
  return null
}

async function sourceVersion(filePath: string, type: SourceType): Promise<string> {
  const stat = await fsp.stat(filePath)
  const parts = [`${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`]
  if (type === 'folder') {
    const names = await sortedFolderImages(filePath)
    const pageParts = await Promise.all(names.map(async (name) => {
      const pageStat = await fsp.stat(path.join(filePath, name))
      return `${name}:${pageStat.mtimeMs}:${pageStat.ctimeMs}:${pageStat.size}`
    }))
    parts.push(...pageParts)
  }
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

const cleanTitle = (v: string): string => v.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()

function displayTitle(filePath: string, rootDir: string, type: SourceType | null): string {
  if (type === 'folder') return cleanTitle(path.basename(filePath))
  const parent = path.dirname(filePath)
  return cleanTitle(parent !== rootDir ? path.basename(parent) : path.basename(filePath, path.extname(filePath)))
}

function categoryFor(filePath: string, rootDir: string): string {
  const rel = path.relative(rootDir, filePath).split(path.sep).filter(Boolean)
  return rel.length > 1 ? cleanTitle(rel[0]) : 'Uncategorized'
}

async function sortedFolderImages(folderPath: string): Promise<string[]> {
  return (await fsp.readdir(folderPath)).filter(isImage).sort(naturalSort)
}

const cacheKey = (filePath: string, stat?: fs.Stats): string => {
  try { const s = stat ?? fs.statSync(filePath); return `${filePath}:${s.mtimeMs}:${s.ctimeMs}:${s.size}` } catch { return filePath }
}

async function loadRar(filePath: string): Promise<RarEntry> {
  const stat = await fsp.stat(filePath)
  const key = cacheKey(filePath, stat)
  const cached = rarCache.get(key)
  if (cached) return cached

  const buf = await fsp.readFile(filePath)
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const extractor = await unrar.createExtractorFromData({ data })
  const headers = [...extractor.getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && isImage(h.name))
    .sort((a, b) => naturalSort(a.name, b.name))
  const extracted = extractor.extract({ files: headers.map((h) => h.name) })
  const content = new Map<string, Buffer>()
  for (const file of extracted.files) {
    if (file.extraction) content.set(file.fileHeader.name, Buffer.from(file.extraction))
  }
  const result: RarEntry = { pages: headers.map((h) => h.name), content }
  rarCache.set(key, result)
  trimMap(rarCache, 12)
  return result
}

function getZipEntryMap(filePath: string): Map<string, AdmZip.IZipEntry> {
  const key = cacheKey(filePath)
  const cached = zipEntryCache.get(key)
  if (cached) return cached
  const zip = new AdmZip(filePath)
  const entries = new Map(
    zip.getEntries()
      .filter((e) => !e.isDirectory && isImage(e.entryName))
      .sort((a, b) => naturalSort(a.entryName, b.entryName))
      .map((e) => [e.entryName, e] as const)
  )
  zipEntryCache.set(key, entries)
  trimMap(zipEntryCache, 16)
  return entries
}

async function sourcePages(filePath: string, type: SourceType): Promise<string[]> {
  if (type === 'folder') return sortedFolderImages(filePath)
  if (type === 'image') return [path.basename(filePath)]
  if (RAR_EXT.has(ext(filePath))) return (await loadRar(filePath)).pages
  return [...getZipEntryMap(filePath).keys()]
}

async function countPages(filePath: string, type: SourceType | null): Promise<number> {
  try { return (await sourcePages(filePath, type ?? sourceType(filePath)!)).length } catch { return 0 }
}

/** `thumbs` maps book id -> existing cover filename, read once per scan. */
async function extractCoverToCache(
  filePath: string, id: string, type: SourceType | null
): Promise<string | null> {
  const out = (e: string): string => path.join(thumbDir(), `${id}-cover${e || '.jpg'}`)
  try {
    if (type === 'image') { const o = out(ext(filePath)); await fsp.copyFile(filePath, o); return o }
    if (type === 'folder') {
      const first = (await sortedFolderImages(filePath))[0]
      if (!first) return null
      const o = out(ext(first)); await fsp.copyFile(path.join(filePath, first), o); return o
    }
    if (RAR_EXT.has(ext(filePath))) {
      const archive = await loadRar(filePath)
      const first = archive.pages[0]
      const data = first && archive.content.get(first)
      if (!first || !data) return null
      const o = out(ext(first)); await fsp.writeFile(o, data); return o
    }
    const first = [...getZipEntryMap(filePath).values()][0]
    if (!first) return null
    const o = out(ext(first.entryName)); await fsp.writeFile(o, first.getData()); return o
  } catch (err) {
    console.error('Cover extraction failed for', filePath, (err as Error).message)
    return null
  }
}

async function pruneThumbnails(books: Book[]): Promise<void> {
  const directory = thumbDir()
  const active = new Set(books.flatMap((book) => book.cover ? [path.resolve(book.cover)] : []))
  const files = await fsp.readdir(directory).catch(() => [] as string[])
  await Promise.all(files.map(async (name) => {
    if (!/^[a-f0-9]{16}-cover\.[a-z0-9]+$/i.test(name)) return
    const filePath = path.join(directory, name)
    if (!active.has(path.resolve(filePath))) await fsp.unlink(filePath).catch(() => undefined)
  }))
}

// ---------- IPC: library & settings ----------
ipcMain.handle('choose-library-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths.length) return null
  libraryScanId += 1
  store.set('libraryFolder', res.filePaths[0])
  startLibraryWatcher()
  return res.filePaths[0]
})

ipcMain.handle('get-settings', () => {
  const prefs: Record<string, unknown> = {}
  for (const key of PREF_KEYS) prefs[key] = store.get(key, DEFAULT_PREFS[key])
  return { ...prefs, libraryFolder: store.get('libraryFolder', null), pinEnabled: !!store.get('pinHash') }
})

const VALIDATORS: { [K in keyof Prefs]: (v: unknown) => boolean } = {
  theme: (v) => v === 'dark' || v === 'light',
  accentColor: (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v),
  cardSize: (v) => v === 'small' || v === 'medium' || v === 'large',
  readingDirection: (v) => v === 'ltr' || v === 'rtl',
  defaultFit: (v) => ['contain', 'width', 'height', 'original'].includes(v as string),
  toolbarAutoHide: (v) => typeof v === 'boolean',
  animationsEnabled: (v) => typeof v === 'boolean',
  toolbarHideDelay: (v) => typeof v === 'number' && v >= 500 && v <= 10000
}

function allowedExternalUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname === '/izumicancode' && !url.username && !url.password
      ? url
      : null
  } catch {
    return null
  }
}

ipcMain.handle('set-setting', (_e, key: keyof Prefs, value: unknown) => {
  if (!PREF_KEYS.includes(key) || !VALIDATORS[key](value)) return false
  store.set(key, value)
  return true
})

ipcMain.handle('reset-settings', () => {
  for (const key of PREF_KEYS) store.delete(key)
  return DEFAULT_PREFS
})

ipcMain.handle('open-external', async (_e, value: unknown) => {
  const url = allowedExternalUrl(value)
  if (!url) return false
  await shell.openExternal(url.href)
  return true
})

ipcMain.handle('scan-library', async (): Promise<ScanResult> => {
  const scanId = ++libraryScanId
  const folder = store.get('libraryFolder') as string | undefined
  if (!folder || !fs.existsSync(folder)) return { books: [], error: 'no-folder' }

  const files = await findLibrarySources(folder)
  const existing = libraryStore.get('books', {}) as Record<string, Book>
  const books: Record<string, Book> = {}
  const failed: string[] = []
  let processed = 0
  for (const filePath of files) {
    if (scanId !== libraryScanId || store.get('libraryFolder') !== folder) {
      return { books: Object.values(libraryStore.get('books', {}) as Record<string, Book>), error: null }
    }
    try {
      const id = hashId(filePath)
      const stat = await fsp.stat(filePath)
      const prev = existing[id]
      const type = sourceType(filePath, stat)
      if (!type) continue
      const version = await sourceVersion(filePath, type)
      const needsRescan = !prev || prev.sourceVersion !== version

      const reuseCover = !needsRescan && prev?.cover && fs.existsSync(prev.cover)
      const cover = reuseCover ? prev.cover : await extractCoverToCache(filePath, id, type)
      const pageCount = needsRescan ? await countPages(filePath, type) : prev.pageCount
      if (pageCount === 0) { failed.push(filePath); continue }

      books[id] = {
        id, type, filePath, cover, pageCount,
        title: displayTitle(filePath, folder, type),
        category: categoryFor(filePath, folder),
        favorite: !!prev?.favorite,
        tags: Array.isArray(prev?.tags) ? prev.tags : [],
        mtimeMs: stat.mtimeMs, sizeBytes: stat.size, sourceVersion: version
      }
    } catch (err) {
      console.error('Skipping unreadable file', filePath, (err as Error).message)
      failed.push(filePath)
    }
    if (++processed % 20 === 0) await new Promise((r) => setImmediate(r))
  }

  if (scanId !== libraryScanId || store.get('libraryFolder') !== folder) {
    return { books: Object.values(libraryStore.get('books', {}) as Record<string, Book>), error: null }
  }
  libraryStore.set('books', books)
  const scannedBooks = Object.values(books)
  await pruneThumbnails(scannedBooks)
  return { books: scannedBooks, error: null, skipped: failed }
})

ipcMain.handle('get-library', () => Object.values(libraryStore.get('books', {}) as Record<string, Book>))

ipcMain.handle('toggle-favorite', (_e, bookId: unknown): boolean | null => {
  try {
    const book = getBook(bookId)
    if (!book) return null
    book.favorite = !book.favorite
    libraryStore.set(`books.${bookId}`, book)
    return book.favorite
  } catch (err) {
    console.error('toggle-favorite failed', (err as Error).message)
    return null
  }
})

// ---------- IPC: reading ----------
ipcMain.handle('open-book', async (_e, bookId: unknown): Promise<OpenBookResult> => {
  try {
    const book = getBook(bookId)
    if (!book || !fs.existsSync(book.filePath)) return { error: 'missing-file' }
    const pages = await sourcePages(book.filePath, book.type ?? sourceType(book.filePath)!)
    if (!pages.length) return { error: 'no-pages' }
    const hist = historyStore.get(book.id, { page: 0 }) as HistoryEntry
    const resumePage = Number.isSafeInteger(hist.page)
      ? Math.max(0, Math.min(hist.page!, pages.length - 1))
      : 0
    const bookmarks = Array.isArray(hist.bookmarks)
      ? [...new Set(hist.bookmarks.filter((page) => Number.isSafeInteger(page) && page >= 0 && page < pages.length))].sort((a, b) => a - b)
      : []
    return {
      error: null, book, pages,
      resumePage,
      bookmarks
    }
  } catch (err) {
    console.error('open-book failed', (err as Error).message)
    return { error: 'read-failed' }
  }
})

ipcMain.handle('save-progress', (_e, bookId: unknown, page: unknown, percent: unknown) => {
  const book = getBook(bookId)
  if (!book || typeof page !== 'number' || !Number.isSafeInteger(page) || page < 0 || page >= book.pageCount ||
      typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 1) return false
  try {
    historyStore.set(book.id, { ...(historyStore.get(book.id, {}) as HistoryEntry), page, percent, lastReadAt: Date.now() })
    return true
  } catch { return false }
})

ipcMain.handle('toggle-bookmark', (_e, bookId: unknown, page: unknown): boolean | null => {
  const book = getBook(bookId)
  if (!book || typeof page !== 'number' || !Number.isSafeInteger(page) || page < 0 || page >= book.pageCount) return null
  try {
    const history = historyStore.get(book.id, {}) as HistoryEntry
    const bookmarks = Array.isArray(history.bookmarks) ? [...history.bookmarks] : []
    const i = bookmarks.indexOf(page)
    if (i >= 0) bookmarks.splice(i, 1); else bookmarks.push(page)
    historyStore.set(book.id, { ...history, bookmarks: bookmarks.sort((a, b) => a - b) })
    return i < 0
  } catch { return null }
})

ipcMain.handle('get-history', (): History => {
  try { return historyStore.store as History } catch { return {} }
})

ipcMain.handle('clear-history', () => {
  try { historyStore.clear(); return true } catch { return false }
})

ipcMain.handle('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  const next = !win.isFullScreen()
  win.setFullScreen(next)
  return next
})

// ---------- IPC: PIN ----------
const scrypt = (pin: string, salt: string): string => crypto.scryptSync(pin, salt, 32).toString('hex')
const legacyHash = (pin: string): string => hashId('salted::' + pin) // v2 config compatibility
let pinFailures = 0
let pinLockedUntil = 0

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b)
  return A.length === B.length && crypto.timingSafeEqual(A, B)
}

function checkPin(pin: unknown): boolean {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false
  const hash = store.get('pinHash') as string | undefined
  if (!hash) return true
  const salt = store.get('pinSalt') as string | undefined
  if (salt) return safeEqual(scrypt(pin, salt), hash)
  if (!safeEqual(legacyHash(pin), hash)) return false
  const upgradedSalt = crypto.randomBytes(16).toString('hex')
  store.set('pinSalt', upgradedSalt)
  store.set('pinHash', scrypt(pin, upgradedSalt))
  return true
}

function verifyPinWithLimit(pin: unknown): boolean {
  const now = Date.now()
  if (pinLockedUntil > now) return false
  if (pinLockedUntil) { pinLockedUntil = 0; pinFailures = 0 }
  if (checkPin(pin)) { pinFailures = 0; return true }
  if (++pinFailures >= 5) {
    pinFailures = 0
    pinLockedUntil = now + 30_000
  }
  return false
}

ipcMain.handle('pin-status', () => ({ enabled: !!store.get('pinHash') }))
ipcMain.handle('pin-set', (_e, pin: unknown) => {
  if (store.get('pinHash') || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return false
  const salt = crypto.randomBytes(16).toString('hex')
  store.set('pinSalt', salt)
  store.set('pinHash', scrypt(pin, salt))
  return true
})
ipcMain.handle('pin-disable', (_e, pin: unknown) => {
  if (!store.get('pinHash') || !verifyPinWithLimit(pin)) return false
  store.delete('pinHash'); store.delete('pinSalt')
  return true
})
ipcMain.handle('pin-verify', (_e, pin: unknown) => verifyPinWithLimit(pin))

// ---------- image protocols ----------
const MIME: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', avif: 'avif' }
const mimeFor = (name: string): string => `image/${MIME[ext(name).slice(1)] || 'jpeg'}`
const notFound = (): Response => new Response(null, { status: 404 })
const IMG_HEADERS = { 'cache-control': 'public, max-age=31536000, immutable' }

async function resolvePageBuffer(book: Book, pageName: string): Promise<Buffer | null> {
  const key = `${book.filePath}:${pageName}:${book.sourceVersion}`
  const cached = pageBinaryCache.get(key)
  if (cached) return cached

  let buf: Buffer | undefined
  if (book.type === 'folder' || book.type === 'image') {
    const p = book.type === 'image' ? book.filePath : path.join(book.filePath, path.basename(pageName))
    if (!fs.existsSync(p)) return null
    buf = await fsp.readFile(p)
  } else if (RAR_EXT.has(ext(book.filePath))) {
    buf = (await loadRar(book.filePath)).content.get(pageName)
  } else {
    buf = getZipEntryMap(book.filePath).get(pageName)?.getData()
  }
  if (!buf) return null
  pageBinaryCache.set(key, buf)
  trimBufferMap(pageBinaryCache, MAX_PAGE_CACHE_BYTES)
  return buf
}

function registerImageProtocols(): void {
  // page://<bookId>/<mtimeMs>/<encoded page name>
  protocol.handle('page', async (request) => {
    try {
      const url = new URL(request.url)
      const book = getBook(url.hostname)
      const [version, ...segments] = url.pathname.split('/').filter(Boolean)
      const pageName = decodeURIComponent(segments.join('/'))
      if (!book || version !== book.sourceVersion || !pageName) return notFound()
      const buf = await resolvePageBuffer(book, pageName)
      if (!buf) return notFound()
      return new Response(new Uint8Array(buf), { headers: { 'content-type': mimeFor(pageName), ...IMG_HEADERS } })
    } catch (err) {
      console.error('page:// failed', (err as Error).message)
      return notFound()
    }
  })

  // cover://<bookId>/<mtimeMs>
  protocol.handle('cover', async (request) => {
    try {
      const url = new URL(request.url)
      const book = getBook(url.hostname)
      const [version] = url.pathname.split('/').filter(Boolean)
      if (!book || version !== book.sourceVersion) return notFound()
      if (!book?.cover || !fs.existsSync(book.cover)) return notFound()
      const res = await net.fetch(pathToFileURL(book.cover).toString())
      return new Response(res.body, { headers: { 'content-type': mimeFor(book.cover), ...IMG_HEADERS } })
    } catch (err) {
      console.error('cover:// failed', (err as Error).message)
      return notFound()
    }
  })
}

// ---------- window ----------
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())

  let recoveries = 0
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', details.reason)
    if (details.reason !== 'clean-exit' && recoveries++ < 1) {
      dialog.showErrorBox('Manga Library', 'The app view crashed and will now reload.')
      win.reload()
    }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  const reportFullscreen = (): void => {
    if (!win.isDestroyed()) win.webContents.send('fullscreen-changed', win.isFullScreen())
  }
  win.on('enter-full-screen', reportFullscreen)
  win.on('leave-full-screen', reportFullscreen)
  win.webContents.setWindowOpenHandler(({ url }) => {
    const allowedUrl = allowedExternalUrl(url)
    if (allowedUrl) void shell.openExternal(allowedUrl.href)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow = win
}

void app.whenReady().then(() => {
  store = new Store({ name: 'config' })
  libraryStore = new Store({ name: 'library' })
  historyStore = new Store({ name: 'history' })
  registerImageProtocols()
  createWindow()
  startLibraryWatcher()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', stopWatching)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const unrar = require('node-unrar-js');
const Store = require('electron-store');

// Custom schemes must be registered before `app` is ready. `page://` and
// `cover://` serve decoded image bytes straight from the main process to the
// <img> tag that requests them. Compared to the previous design — read file,
// base64-encode it, JSON-stringify it across an ipcRenderer.invoke round
// trip, then set it as a data: URI — this avoids a ~33% size penalty from
// base64, the structured-clone/serialization cost of multi-megabyte IPC
// payloads, and lets Chromium's normal HTTP image cache and decode pipeline
// do their job (including off-main-thread decoding), the same way a modern
// image-loading pipeline like Coil (used by Mihon) streams bytes directly
// into the view instead of shuttling encoded strings through a bridge.
protocol.registerSchemesAsPrivileged([
  { scheme: 'page', privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'cover', privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// GPU-accelerated compositing/scaling is what makes large page images and
// grid animations feel smooth — the previous build force-disabled it, which
// helps only on a narrow set of broken drivers but costs everyone else a
// slower reader. Leave acceleration on by default.

// Catch anything that would otherwise crash the whole main process silently.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection:', err);
});

let store, libraryStore, historyStore;
let mainWindow;
let fsWatcher = null;
let fallbackPollTimer = null;
let watchDebounceTimer = null;
let lastLibrarySignature = '';

function initStores() {
  store = new Store({ name: 'config' });
  libraryStore = new Store({ name: 'library' });
  historyStore = new Store({ name: 'history' });
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const ARCHIVE_EXT = new Set(['.cbz', '.zip', '.cbr', '.rar']);
const RAR_EXT = new Set(['.cbr', '.rar']);

// Small in-memory caches so re-opening a book or flipping back a page doesn't
// re-open/re-decode a zip or rar archive from disk every time. Bounded by
// entry count to keep a steady memory ceiling regardless of library size.
const rarCache = new Map();
const archiveEntryCache = new Map();
const pageBinaryCache = new Map();

const thumbDir = () => {
  const dir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function hashId(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function trimMap(map, maxEntries) {
  if (map.size <= maxEntries) return;
  const over = map.size - maxEntries;
  for (let i = 0; i < over; i++) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
}

// ---------- Library scanning ----------

async function findLibrarySources(rootDir) {
  const results = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        let childEntries = [];
        try { childEntries = await fsp.readdir(full, { withFileTypes: true }); } catch { /* unreadable */ }
        const hasImages = childEntries.some((child) => child.isFile() && IMAGE_EXT.has(path.extname(child.name).toLowerCase()));
        if (hasImages) results.push(full);
        else await walk(full);
      } else if (entry.isFile() && (ARCHIVE_EXT.has(path.extname(entry.name).toLowerCase()) || IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))) {
        results.push(full);
      }
    }
  }
  await walk(rootDir);
  return results;
}

function librarySignatureSync(rootDir) {
  // Only used by the change-detection watcher, which already debounces and
  // fires rarely, so a sync recursive walk here is fine.
  const results = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        let childEntries = [];
        try { childEntries = fs.readdirSync(full, { withFileTypes: true }); } catch { /* unreadable */ }
        const hasImages = childEntries.some((child) => child.isFile() && IMAGE_EXT.has(path.extname(child.name).toLowerCase()));
        if (hasImages) results.push(full);
        else walk(full);
      } else if (entry.isFile() && (ARCHIVE_EXT.has(path.extname(entry.name).toLowerCase()) || IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))) {
        results.push(full);
      }
    }
  })(rootDir);
  return results.map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return `${filePath}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${filePath}:missing`;
    }
  }).sort().join('|');
}

function stopWatching() {
  if (fsWatcher) { try { fsWatcher.close(); } catch { /* already closed */ } fsWatcher = null; }
  clearInterval(fallbackPollTimer);
  fallbackPollTimer = null;
  clearTimeout(watchDebounceTimer);
}

function notifyIfLibraryChanged(folder) {
  const signature = librarySignatureSync(folder);
  if (!lastLibrarySignature) { lastLibrarySignature = signature; return; }
  if (signature === lastLibrarySignature) return;
  lastLibrarySignature = signature;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('library-changed');
}

// Event-driven watching (fs.watch) reacts instantly and uses no CPU while
// idle, unlike a polling timer. Recursive watching isn't supported on every
// platform (notably plain Linux), so that case falls back to a slower poll
// instead of silently doing nothing.
function startLibraryWatcher() {
  stopWatching();
  lastLibrarySignature = '';
  const folder = store && store.get('libraryFolder');
  if (!folder || !fs.existsSync(folder)) return;

  const onChange = () => {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => notifyIfLibraryChanged(folder), 800);
  };

  try {
    fsWatcher = fs.watch(folder, { recursive: true }, onChange);
    fsWatcher.on('error', () => { stopWatching(); fallbackPollTimer = setInterval(() => notifyIfLibraryChanged(folder), 8000); });
  } catch {
    fallbackPollTimer = setInterval(() => notifyIfLibraryChanged(folder), 8000);
  }
}

function sourceType(filePath, stat) {
  if ((stat || fs.statSync(filePath)).isDirectory()) return 'folder';
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  return null;
}

function cleanTitle(value) {
  return value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function displayTitle(filePath, rootDir, type) {
  if (type === 'folder') return cleanTitle(path.basename(filePath));
  const parent = path.dirname(filePath);
  return cleanTitle(parent !== rootDir ? path.basename(parent) : path.basename(filePath, path.extname(filePath)));
}

function categoryFor(filePath, rootDir) {
  const relative = path.relative(rootDir, filePath).split(path.sep).filter(Boolean);
  return relative.length > 1 ? cleanTitle(relative[0]) : 'Uncategorized';
}

function sortedImageEntries(zip) {
  return zip.getEntries()
    .filter((e) => !e.isDirectory && IMAGE_EXT.has(path.extname(e.entryName).toLowerCase()))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
}

async function sortedFolderImages(folderPath) {
  const names = await fsp.readdir(folderPath);
  return names
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function cacheKey(filePath, stat) {
  try {
    const s = stat || fs.statSync(filePath);
    return `${filePath}:${s.mtimeMs}:${s.size}`;
  } catch {
    return filePath;
  }
}

async function loadRar(filePath) {
  const stat = await fsp.stat(filePath);
  const key = cacheKey(filePath, stat);
  const cached = rarCache.get(key);
  if (cached) return cached;

  const data = Uint8Array.from(await fsp.readFile(filePath)).buffer;
  const extractor = await unrar.createExtractorFromData({ data });
  const headers = [...extractor.getFileList().fileHeaders]
    .filter((header) => !header.flags.directory && IMAGE_EXT.has(path.extname(header.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const extracted = extractor.extract({ files: headers.map((header) => header.name) });
  const content = new Map();
  for (const file of extracted.files) content.set(file.fileHeader.name, Buffer.from(file.extraction));
  const result = { mtimeMs: stat.mtimeMs, pages: headers.map((header) => header.name), content };
  rarCache.set(key, result);
  trimMap(rarCache, 12);
  return result;
}

function getZipEntryMap(filePath) {
  const key = cacheKey(filePath);
  const cached = archiveEntryCache.get(key);
  if (cached) return cached;

  const zip = new AdmZip(filePath);
  const entries = new Map(
    zip.getEntries()
      .filter((e) => !e.isDirectory && IMAGE_EXT.has(path.extname(e.entryName).toLowerCase()))
      .map((entry) => [entry.entryName, entry])
  );
  archiveEntryCache.set(key, entries);
  trimMap(archiveEntryCache, 16);
  return entries;
}

async function sourcePages(filePath, type) {
  if (type === 'folder') return sortedFolderImages(filePath);
  if (type === 'image') return [path.basename(filePath)];
  if (RAR_EXT.has(path.extname(filePath).toLowerCase())) return (await loadRar(filePath)).pages;
  return [...getZipEntryMap(filePath).keys()];
}

async function countPages(filePath, type) {
  try { return (await sourcePages(filePath, type || sourceType(filePath))).length; } catch { return 0; }
}

// `existingThumbs` is a single pre-read directory listing shared across an
// entire scan pass, so checking "do we already have a cover for this id"
// is a Set lookup instead of a fresh fs.readdir() per book — the previous
// version read the whole thumbnails directory once per title, which turns
// an O(n) scan into O(n^2) as a library grows into the thousands.
async function extractCoverToCache(filePath, id, type, existingThumbs) {
  const existing = existingThumbs && [...existingThumbs].find((f) => f.startsWith(id + '-cover.'));
  if (existing) return path.join(thumbDir(), existing);
  try {
    if (type === 'image') {
      const outPath = path.join(thumbDir(), `${id}-cover${path.extname(filePath).toLowerCase()}`);
      await fsp.copyFile(filePath, outPath);
      return outPath;
    }
    if (type === 'folder') {
      const first = (await sortedFolderImages(filePath))[0];
      if (!first) return null;
      const outPath = path.join(thumbDir(), `${id}-cover${path.extname(first).toLowerCase()}`);
      await fsp.copyFile(path.join(filePath, first), outPath);
      return outPath;
    }
    if (RAR_EXT.has(path.extname(filePath).toLowerCase())) {
      const archive = await loadRar(filePath);
      const first = archive.pages[0];
      if (!first) return null;
      const outPath = path.join(thumbDir(), `${id}-cover${path.extname(first).toLowerCase()}`);
      await fsp.writeFile(outPath, archive.content.get(first));
      return outPath;
    }
    const zip = new AdmZip(filePath);
    const images = sortedImageEntries(zip);
    if (!images.length) return null;
    const ext = path.extname(images[0].entryName).toLowerCase() || '.jpg';
    const outPath = path.join(thumbDir(), `${id}-cover${ext}`);
    await fsp.writeFile(outPath, images[0].getData());
    return outPath;
  } catch (err) {
    console.error('Cover extraction failed for', filePath, err.message);
    return null;
  }
}

// ---------- IPC: library ----------

ipcMain.handle('choose-library-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const folder = res.filePaths[0];
  store.set('libraryFolder', folder);
  startLibraryWatcher();
  return folder;
});

// Whitelisted, user-customizable preferences with sane defaults. Keeping this
// as an explicit list (rather than accepting arbitrary keys from the renderer)
// stops a compromised/buggy renderer call from writing junk into config.json.
const DEFAULT_PREFS = {
  theme: 'dark',
  accentColor: '#e0555a',
  cardSize: 'medium',
  readingDirection: 'ltr',
  defaultFit: 'contain',
  toolbarAutoHide: true,
  toolbarHideDelay: 2500,
  animationsEnabled: true,
};
const PREF_KEYS = Object.keys(DEFAULT_PREFS);

ipcMain.handle('get-settings', () => {
  const prefs = {};
  for (const key of PREF_KEYS) prefs[key] = store.get(key, DEFAULT_PREFS[key]);
  return { ...prefs, libraryFolder: store.get('libraryFolder', null), pinEnabled: !!store.get('pinHash') };
});

ipcMain.handle('set-setting', (e, key, value) => {
  if (!PREF_KEYS.includes(key)) return false;
  if (key === 'accentColor' && !/^#[0-9a-fA-F]{6}$/.test(value)) return false;
  if (key === 'cardSize' && !['small', 'medium', 'large'].includes(value)) return false;
  if (key === 'readingDirection' && !['ltr', 'rtl'].includes(value)) return false;
  if (key === 'defaultFit' && !['contain', 'width', 'height', 'original'].includes(value)) return false;
  if (key === 'theme' && !['dark', 'light'].includes(value)) return false;
  if ((key === 'toolbarAutoHide' || key === 'animationsEnabled') && typeof value !== 'boolean') return false;
  if (key === 'toolbarHideDelay' && (typeof value !== 'number' || value < 500 || value > 10000)) return false;
  store.set(key, value);
  return true;
});

ipcMain.handle('reset-settings', () => {
  for (const key of PREF_KEYS) store.delete(key);
  return DEFAULT_PREFS;
});

ipcMain.handle('open-external', (e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

ipcMain.handle('scan-library', async () => {
  const folder = store.get('libraryFolder');
  if (!folder || !fs.existsSync(folder)) return { books: [], error: 'no-folder' };

  const files = await findLibrarySources(folder);
  const existing = libraryStore.get('books', {});
  const books = {};
  const failed = [];
  const existingThumbs = new Set(await fsp.readdir(thumbDir()).catch(() => []));

  let processed = 0;
  for (const filePath of files) {
    try {
      const id = hashId(filePath);
      const stat = await fsp.stat(filePath);
      const prev = existing[id];
      const needsRescan = !prev || prev.mtimeMs !== stat.mtimeMs;

      const type = sourceType(filePath, stat);
      const title = displayTitle(filePath, folder, type);
      const category = categoryFor(filePath, folder);

      // Unchanged file with a still-valid cached cover: skip re-deriving it.
      const reuseCover = !needsRescan && prev && prev.cover && fs.existsSync(prev.cover);
      const cover = reuseCover ? prev.cover : await extractCoverToCache(filePath, id, type, existingThumbs);
      const pageCount = needsRescan ? await countPages(filePath, type) : prev.pageCount;

      // A CBZ with zero readable images is corrupt/unsupported — keep it out
      // of the library instead of showing a permanently-broken card.
      if (pageCount === 0) { failed.push(filePath); continue; }

      books[id] = {
        id, title, category, type, filePath, cover, pageCount,
        favorite: !!(prev && prev.favorite), tags: prev && Array.isArray(prev.tags) ? prev.tags : [],
        mtimeMs: stat.mtimeMs, sizeBytes: stat.size,
      };
    } catch (err) {
      console.error('Skipping unreadable file', filePath, err.message);
      failed.push(filePath);
    }

    // Yield to the event loop periodically so a large library scan never
    // blocks IPC, window resize, or anything else on the main process.
    if (++processed % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
  }

  libraryStore.set('books', books);
  return { books: Object.values(books), error: null, skipped: failed };
});

ipcMain.handle('get-library', () => Object.values(libraryStore.get('books', {})));

ipcMain.handle('toggle-favorite', (e, bookId) => {
  try {
    const book = libraryStore.get(`books.${bookId}`);
    if (!book) return false;
    book.favorite = !book.favorite;
    libraryStore.set(`books.${bookId}`, book);
    return book.favorite;
  } catch (err) {
    console.error('toggle-favorite failed', err.message);
    return false;
  }
});

// ---------- IPC: reading ----------

ipcMain.handle('open-book', async (e, bookId) => {
  try {
    const book = libraryStore.get(`books.${bookId}`);
    if (!book || !fs.existsSync(book.filePath)) return { error: 'missing-file' };
    const pages = await sourcePages(book.filePath, book.type || sourceType(book.filePath));
    if (!pages.length) return { error: 'no-pages' };
    const hist = historyStore.get(bookId, { page: 0, percent: 0 });
    const resumePage = Math.min(hist.page || 0, pages.length - 1);
    return { book, pages, resumePage, bookmarks: hist.bookmarks || [], error: null };
  } catch (err) {
    console.error('open-book failed', err.message);
    return { error: 'read-failed' };
  }
});

ipcMain.handle('save-progress', (e, bookId, page, percent) => {
  try {
    historyStore.set(bookId, { ...historyStore.get(bookId, {}), page, percent, lastReadAt: Date.now() });
    return true;
  } catch (err) {
    console.error('save-progress failed', err.message);
    return false;
  }
});

ipcMain.handle('toggle-bookmark', (e, bookId, page) => {
  try {
    const history = historyStore.get(bookId, {});
    const bookmarks = Array.isArray(history.bookmarks) ? history.bookmarks : [];
    const index = bookmarks.indexOf(page);
    if (index >= 0) bookmarks.splice(index, 1);
    else bookmarks.push(page);
    historyStore.set(bookId, { ...history, bookmarks: bookmarks.sort((a, b) => a - b) });
    return index < 0;
  } catch (err) {
    console.error('toggle-bookmark failed', err.message);
    return false;
  }
});

ipcMain.handle('get-history', () => {
  try { return historyStore.store; } catch { return {}; }
});

ipcMain.handle('clear-history', () => {
  try {
    if (!historyStore) return false;
    historyStore.clear();
    return Object.keys(historyStore.store).length === 0;
  } catch (err) {
    console.error('clear-history failed', err.message);
    return false;
  }
});

ipcMain.handle('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

// ---------- IPC: PIN security ----------

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

ipcMain.handle('pin-status', () => ({ enabled: !!store.get('pinHash') }));

ipcMain.handle('pin-set', (e, pin) => {
  if (!/^\d{4}$/.test(pin || '')) return false;
  store.set('pinHash', hashId('salted::' + pin));
  return true;
});

ipcMain.handle('pin-disable', (e, currentPin) => {
  const hash = store.get('pinHash');
  if (hash && safeEqual(hashId('salted::' + currentPin), hash)) {
    store.delete('pinHash');
    return true;
  }
  return false;
});

ipcMain.handle('pin-verify', (e, pin) => {
  const hash = store.get('pinHash');
  if (!hash) return true;
  return safeEqual(hashId('salted::' + pin), hash);
});

// ---------- Image protocols ----------

const MIME_BY_EXT = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', avif: 'avif',
};

function mimeFor(name) {
  const ext = path.extname(name).toLowerCase().replace('.', '');
  return `image/${MIME_BY_EXT[ext] || 'jpeg'}`;
}

function notFound() {
  return new Response(null, { status: 404 });
}

async function resolvePageBuffer(book, pageName) {
  const type = book.type || sourceType(book.filePath);
  const cacheKeyForPage = `${book.filePath}:${pageName}:${book.mtimeMs || '0'}`;

  const cached = pageBinaryCache.get(cacheKeyForPage);
  if (cached) return cached;

  let buf;
  if (type === 'folder' || type === 'image') {
    const imagePath = type === 'image' ? book.filePath : path.join(book.filePath, pageName);
    if (!fs.existsSync(imagePath)) return null;
    buf = await fsp.readFile(imagePath);
  } else if (RAR_EXT.has(path.extname(book.filePath).toLowerCase())) {
    buf = (await loadRar(book.filePath)).content.get(pageName);
    if (!buf) return null;
  } else {
    const entry = getZipEntryMap(book.filePath).get(pageName);
    if (!entry) return null;
    buf = entry.getData();
  }

  if (!buf) return null;
  pageBinaryCache.set(cacheKeyForPage, buf);
  trimMap(pageBinaryCache, 96);
  return buf;
}

function registerImageProtocols() {
  // page://<bookId>/<mtimeMs>/<encoded page name>
  protocol.handle('page', async (request) => {
    try {
      const url = new URL(request.url);
      const bookId = url.hostname;
      const segments = url.pathname.split('/').filter(Boolean);
      const pageName = decodeURIComponent(segments.slice(1).join('/'));
      const book = libraryStore.get(`books.${bookId}`);
      if (!book || !pageName) return notFound();

      const buf = await resolvePageBuffer(book, pageName);
      if (!buf) return notFound();
      return new Response(buf, {
        headers: { 'content-type': mimeFor(pageName), 'cache-control': 'public, max-age=31536000, immutable' },
      });
    } catch (err) {
      console.error('page:// handler failed', err.message);
      return notFound();
    }
  });

  // cover://<bookId>/<mtimeMs>
  protocol.handle('cover', async (request) => {
    try {
      const url = new URL(request.url);
      const bookId = url.hostname;
      const book = libraryStore.get(`books.${bookId}`);
      if (!book || !book.cover || !fs.existsSync(book.cover)) return notFound();
      return net.fetch(`file://${book.cover.replace(/#/g, '%23')}`).then((res) => new Response(res.body, {
        headers: { 'content-type': mimeFor(book.cover), 'cache-control': 'public, max-age=31536000, immutable' },
      }));
    } catch (err) {
      console.error('cover:// handler failed', err.message);
      return notFound();
    }
  });
}

// ---------- window ----------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // If the renderer crashes (OOM, GPU issue, etc.) it would otherwise leave a
  // blank/frozen window with no feedback — reload instead of leaving it dead.
  let recoveryAttempts = 0;
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer process gone:', details.reason);
    if (details.reason !== 'clean-exit' && recoveryAttempts < 1) {
      recoveryAttempts++;
      dialog.showErrorBox('Manga Library', 'The app view crashed and will now reload.');
      win.reload();
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[main] page failed to load:', code, desc);
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  try {
    initStores();
  } catch (err) {
    console.error('[main] failed to init stores:', err);
  }
  registerImageProtocols();
  createWindow();
  startLibraryWatcher();
});

app.on('before-quit', stopWatching);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

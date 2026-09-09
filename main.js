const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Store = require('electron-store');

// Catch anything that would otherwise crash the whole main process silently.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection:', err);
});

let store, libraryStore, historyStore;
function initStores() {
  store = new Store({ name: 'config' });
  libraryStore = new Store({ name: 'library' });
  historyStore = new Store({ name: 'history' });
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const thumbDir = () => {
  const dir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function hashId(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function findCbzFiles(rootDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cbz')) results.push(full);
    }
  }
  walk(rootDir);
  return results;
}

function sortedImageEntries(zip) {
  return zip.getEntries()
    .filter(e => !e.isDirectory && IMAGE_EXT.has(path.extname(e.entryName).toLowerCase()))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
}

// Determines the correct file extension for a cached cover, since the source
// image inside the zip might be png/webp/etc, not always jpg.
function extractCoverToCache(filePath, id) {
  const existing = fs.readdirSync(thumbDir()).find(f => f.startsWith(id + '.'));
  if (existing) return path.join(thumbDir(), existing);
  try {
    const zip = new AdmZip(filePath);
    const images = sortedImageEntries(zip);
    if (!images.length) return null;
    const ext = path.extname(images[0].entryName).toLowerCase() || '.jpg';
    const outPath = path.join(thumbDir(), `${id}${ext}`);
    fs.writeFileSync(outPath, images[0].getData());
    return outPath;
  } catch (err) {
    console.error('Cover extraction failed for', filePath, err.message);
    return null;
  }
}

function countPages(filePath) {
  try {
    const zip = new AdmZip(filePath);
    return sortedImageEntries(zip).length;
  } catch { return 0; }
}

// ---------- IPC: library ----------

ipcMain.handle('choose-library-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const folder = res.filePaths[0];
  store.set('libraryFolder', folder);
  return folder;
});

// Whitelisted, user-customizable preferences with sane defaults. Keeping this
// as an explicit list (rather than accepting arbitrary keys from the renderer)
// stops a compromised/buggy renderer call from writing junk into config.json.
const DEFAULT_PREFS = {
  theme: 'dark',              // 'dark' | 'light'
  accentColor: '#e0555a',     // any valid CSS hex color
  cardSize: 'medium',         // 'small' | 'medium' | 'large'
  readingDirection: 'ltr',    // 'ltr' | 'rtl' (manga is often right-to-left)
  defaultFit: 'contain',      // 'contain' | 'width' | 'height' | 'original'
  toolbarAutoHide: true,
  toolbarHideDelay: 2500,     // ms
  animationsEnabled: true,
};
const PREF_KEYS = Object.keys(DEFAULT_PREFS);

ipcMain.handle('get-settings', () => {
  const prefs = {};
  for (const key of PREF_KEYS) prefs[key] = store.get(key, DEFAULT_PREFS[key]);
  return {
    ...prefs,
    libraryFolder: store.get('libraryFolder', null),
    pinEnabled: !!store.get('pinHash'),
  };
});

ipcMain.handle('set-setting', (e, key, value) => {
  if (!PREF_KEYS.includes(key)) return false;
  // Light validation per key so a bad value from the UI can't corrupt state.
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

  const files = findCbzFiles(folder);
  const existing = libraryStore.get('books', {});
  const books = {};
  const failed = [];

  for (const filePath of files) {
    try {
      const id = hashId(filePath);
      const stat = fs.statSync(filePath);
      const prev = existing[id];
      const needsRescan = !prev || prev.mtimeMs !== stat.mtimeMs;

      const title = path.basename(filePath, '.cbz').replace(/[._]+/g, ' ').trim();
      const cover = extractCoverToCache(filePath, id);
      const pageCount = needsRescan ? countPages(filePath) : prev.pageCount;

      // A CBZ with zero readable images is corrupt/unsupported — keep it out of
      // the library instead of showing a permanently-broken card.
      if (pageCount === 0) { failed.push(filePath); continue; }

      books[id] = { id, title, filePath, cover, pageCount, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    } catch (err) {
      console.error('Skipping unreadable file', filePath, err.message);
      failed.push(filePath);
    }
  }

  libraryStore.set('books', books);
  return { books: Object.values(books), error: null, skipped: failed };
});

// Reads the already-cached cover thumbnail straight off disk (fast — no zip
// re-open per grid card). Falls back to null if not cached yet.
ipcMain.handle('get-cover', (e, bookId) => {
  try {
    const book = libraryStore.get(`books.${bookId}`);
    if (!book || !book.cover || !fs.existsSync(book.cover)) return null;
    const buf = fs.readFileSync(book.cover);
    const ext = path.extname(book.cover).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('get-cover failed', err.message);
    return null;
  }
});

ipcMain.handle('get-library', () => Object.values(libraryStore.get('books', {})));

// ---------- IPC: reading ----------

ipcMain.handle('open-book', (e, bookId) => {
  try {
    const book = libraryStore.get(`books.${bookId}`);
    if (!book || !fs.existsSync(book.filePath)) return { error: 'missing-file' };
    const zip = new AdmZip(book.filePath);
    const pages = sortedImageEntries(zip).map(en => en.entryName);
    if (!pages.length) return { error: 'no-pages' };
    const hist = historyStore.get(bookId, { page: 0, percent: 0 });
    const resumePage = Math.min(hist.page || 0, pages.length - 1);
    return { book, pages, resumePage, error: null };
  } catch (err) {
    console.error('open-book failed', err.message);
    return { error: 'read-failed' };
  }
});

ipcMain.handle('get-page', (e, bookId, pageName) => {
  try {
    const book = libraryStore.get(`books.${bookId}`);
    if (!book) return null;
    const zip = new AdmZip(book.filePath);
    const entry = zip.getEntry(pageName);
    if (!entry) return null;
    const buf = entry.getData();
    const ext = path.extname(pageName).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('get-page failed', err.message);
    return null;
  }
});

ipcMain.handle('save-progress', (e, bookId, page, percent) => {
  try {
    historyStore.set(bookId, { page, percent, lastReadAt: Date.now() });
    return true;
  } catch (err) {
    console.error('save-progress failed', err.message);
    return false;
  }
});

ipcMain.handle('get-history', () => {
  try { return historyStore.store; } catch { return {}; }
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
  if (!/^\d{4,6}$/.test(pin || '')) return false;
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

// ---------- window ----------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // If the renderer crashes (OOM, GPU issue, etc.) it would otherwise leave a
  // blank/frozen window with no feedback — reload instead of leaving it dead.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer process gone:', details.reason);
    if (details.reason !== 'clean-exit') {
      dialog.showErrorBox('Manga Library', 'The app view crashed and will now reload.');
      win.reload();
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[main] page failed to load:', code, desc);
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  try {
    initStores();
  } catch (err) {
    console.error('[main] failed to init stores:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

import { state, FIT_LABELS, FIT_CYCLE, bus } from './state.js';
import { $, safeInvoke, showToast } from './util.js';

// Preloading the next couple of pages (and the previous one, for back-flips)
// means the browser has already fetched and decoded the image by the time
// the reader actually needs it, so turning pages feels instant instead of
// popping in — the same idea as a modern reader's read-ahead prefetch.
const PRELOAD_AHEAD = 2;
const PRELOAD_BEHIND = 1;
const preloaded = new Set();

function pageUrlFor(index) {
  const { currentBook, currentPages } = state;
  if (!currentBook || index < 0 || index >= currentPages.length) return null;
  return window.api.pageUrl(currentBook.id, currentBook.mtimeMs, currentPages[index]);
}

function preloadAround(index) {
  const from = Math.max(0, index - PRELOAD_BEHIND);
  const to = Math.min(state.currentPages.length - 1, index + PRELOAD_AHEAD);
  for (let i = from; i <= to; i++) {
    const url = pageUrlFor(i);
    if (!url || preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

export async function openReader(bookId) {
  const opened = await safeInvoke(window.api.openBook(bookId), { error: 'ipc-failed' }, "Couldn't open that book.");
  if (!opened || opened.error) {
    const messages = {
      'missing-file': 'That file no longer exists on disk. Try rescanning your library.',
      'no-pages': "This archive doesn't contain any readable images.",
      'read-failed': "That file couldn't be read — it may be corrupted.",
    };
    showToast(messages[opened && opened.error] || "Couldn't open that book.");
    return;
  }
  preloaded.clear();
  state.currentBook = opened.book;
  state.currentPages = opened.pages;
  state.currentIndex = Math.min(Math.max(opened.resumePage, 0), opened.pages.length - 1);
  state.bookmarks = opened.bookmarks || [];
  state.zoom = 1;
  state.spread = false;

  $('#reader').classList.remove('hidden');
  $('#reader-title').textContent = opened.book.title;
  state.fitMode = state.settings.defaultFit || 'contain';
  applyFitMode();
  applyZoom();
  updateSpreadButton();
  updateBookmarkButton();
  if (window.showReaderToolbar) window.showReaderToolbar();
  renderCurrentPage();
}

function renderCurrentPage() {
  const { currentBook, currentPages, currentIndex } = state;
  if (!currentBook || !currentPages.length) return;

  const primary = pageUrlFor(currentIndex);
  if (primary) $('#reader-page').src = primary;

  const secondary = $('#reader-page-secondary');
  const secondaryUrl = state.spread ? pageUrlFor(currentIndex + 1) : null;
  if (secondaryUrl) {
    secondary.src = secondaryUrl;
    secondary.classList.remove('hidden');
  } else {
    secondary.classList.add('hidden');
  }

  $('#reader-counter').textContent = `${currentIndex + 1} / ${currentPages.length}`;
  const percent = (currentIndex + 1) / currentPages.length;
  safeInvoke(window.api.saveProgress(currentBook.id, currentIndex, percent), false, '');
  updateBookmarkButton();
  preloadAround(currentIndex);
}

export function closeReader() {
  $('#reader').classList.add('hidden');
  bus.dispatchEvent(new Event('reader-closed'));
}

export function nextPage() {
  const step = state.spread ? 2 : 1;
  if (state.currentIndex < state.currentPages.length - 1) {
    state.currentIndex = Math.min(state.currentIndex + step, state.currentPages.length - 1);
    renderCurrentPage();
  }
}

export function prevPage() {
  if (state.currentIndex > 0) {
    state.currentIndex = Math.max(state.currentIndex - (state.spread ? 2 : 1), 0);
    renderCurrentPage();
  }
}

// Reading direction determines what "next"/"forward" means, so both the
// buttons and the keyboard shortcuts route through this single function.
export function turnPage(direction) {
  if (direction === 'next') nextPage(); else prevPage();
}

export function cycleFitMode() {
  const idx = FIT_CYCLE.indexOf(state.fitMode);
  state.fitMode = FIT_CYCLE[(idx + 1) % FIT_CYCLE.length];
  applyFitMode();
}

export function applyFitMode() {
  const img = $('#reader-page');
  FIT_CYCLE.forEach((m) => img.classList.remove(`fit-${m}`));
  if (state.fitMode !== 'contain') img.classList.add(`fit-${state.fitMode}`);
  $('#reader-fit').textContent = FIT_LABELS[state.fitMode];
}

export function applyZoom() {
  const scale = state.zoom;
  $('#reader-page').style.transform = `scale(${scale})`;
  $('#reader-page-secondary').style.transform = `scale(${scale})`;
  $('#reader-zoom-label').textContent = `${Math.round(scale * 100)}%`;
}

export function changeZoom(delta) {
  state.zoom = Math.min(3, Math.max(0.5, Math.round((state.zoom + delta) * 10) / 10));
  applyZoom();
}

export function updateBookmarkButton() {
  const bookmarked = state.bookmarks.includes(state.currentIndex);
  $('#reader-bookmark').textContent = bookmarked ? 'Bookmarked' : 'Bookmark';
  $('#reader-bookmark').classList.toggle('active', bookmarked);
}

export function updateSpreadButton() {
  $('#reader-spread').textContent = state.spread ? 'Single Page' : 'Spread';
  $('#reader-page').classList.toggle('spread', state.spread);
  $('#reader-page-secondary').classList.toggle('spread', state.spread);
}

// Swipe left/right (touch or pointer drag) turns pages, mirroring
// touch-first manga readers. A small threshold and a max-duration/verticality
// check keep it from firing on ordinary scrolls or taps.
function bindSwipeGestures() {
  const wrap = $('#reader-page-wrap');
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  wrap.addEventListener('pointerdown', (e) => {
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
    startTime = performance.now();
  });

  wrap.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const elapsed = performance.now() - startTime;
    if (elapsed > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const rtl = state.settings.readingDirection === 'rtl';
    if (dx < 0) turnPage(rtl ? 'prev' : 'next');
    else turnPage(rtl ? 'next' : 'prev');
  });

  wrap.addEventListener('pointercancel', () => { tracking = false; });
}

export function bindReaderEvents() {
  $('#reader-back').addEventListener('click', closeReader);
  $('#reader-next').addEventListener('click', () => turnPage('next'));
  $('#reader-prev').addEventListener('click', () => turnPage('prev'));
  $('#reader-fit').addEventListener('click', cycleFitMode);
  $('#reader-zoom-out').addEventListener('click', () => changeZoom(-0.1));
  $('#reader-zoom-in').addEventListener('click', () => changeZoom(0.1));
  $('#reader-bookmark').addEventListener('click', async () => {
    const bookmarked = await safeInvoke(window.api.toggleBookmark(state.currentBook.id, state.currentIndex), null, "Couldn't update bookmark.");
    if (bookmarked === null) return;
    state.bookmarks = bookmarked
      ? [...state.bookmarks, state.currentIndex].sort((a, b) => a - b)
      : state.bookmarks.filter((page) => page !== state.currentIndex);
    updateBookmarkButton();
  });
  $('#reader-spread').addEventListener('click', () => {
    state.spread = !state.spread;
    updateSpreadButton();
    renderCurrentPage();
  });
  $('#reader-fullscreen').addEventListener('click', async () => {
    const isFullscreen = await safeInvoke(window.api.toggleFullscreen(), false, "Couldn't toggle fullscreen.");
    $('#reader-fullscreen').textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  });

  bindSwipeGestures();

  document.addEventListener('keydown', (e) => {
    if ($('#reader').classList.contains('hidden')) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'd') turnPage(state.settings.readingDirection === 'rtl' ? 'prev' : 'next');
    if (key === 'arrowleft' || key === 'a') turnPage(state.settings.readingDirection === 'rtl' ? 'next' : 'prev');
    if (key === 'f' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      $('#reader-fullscreen').click();
    } else if (key === 'f') cycleFitMode();
    if (key === '+' || key === '=') changeZoom(0.1);
    if (key === '-') changeZoom(-0.1);
    if (key === 'b') $('#reader-bookmark').click();
    if (key === 's') $('#reader-spread').click();
    if (e.key === 'Escape') closeReader();
  });

  let toolbarTimer;
  const scheduleToolbarHide = () => {
    clearTimeout(toolbarTimer);
    if (state.settings.toolbarAutoHide === false) return; // stays visible
    toolbarTimer = setTimeout(() => $('#reader').classList.remove('show-toolbar'), state.settings.toolbarHideDelay || 2500);
  };
  window.showReaderToolbar = () => { $('#reader').classList.add('show-toolbar'); scheduleToolbarHide(); };
  $('#reader').addEventListener('mousemove', window.showReaderToolbar);
}

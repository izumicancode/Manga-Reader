const state = {
  books: [],
  history: {},
  currentBook: null,
  currentPages: [],
  currentIndex: 0,
  settings: {},
  fitMode: 'contain',
  category: 'all',
};

const ACCENT_PRESETS = ['#e0555a', '#e08a3c', '#d8c445', '#5fb87a', '#4a9fd8', '#8a6fd8', '#d85fa8'];
const FIT_LABELS = { contain: 'Fit: Page', width: 'Fit: Width', height: 'Fit: Height', original: 'Fit: Original' };
const FIT_CYCLE = ['contain', 'width', 'height', 'original'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Surface unexpected errors instead of letting the UI silently freeze.
window.addEventListener('error', (e) => console.error('[renderer] error:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer] unhandled rejection:', e.reason));

// Wraps an IPC call so a failure shows a toast instead of hanging the UI.
async function safeInvoke(promise, fallback, errorMessage) {
  try {
    return await promise;
  } catch (err) {
    console.error(errorMessage || '[ipc error]', err);
    if (errorMessage) showToast(errorMessage);
    return fallback;
  }
}

function showToast(message) {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ---------- Boot ----------

async function boot() {
  try {
    const settings = await safeInvoke(window.api.getSettings(), {}, '');
    state.settings = { ...DEFAULTS_FALLBACK, ...settings };
    applyAppearance(state.settings);

    const pinStatus = await safeInvoke(window.api.pinStatus(), { enabled: false }, '');
    if (pinStatus.enabled) {
      showLockScreen();
    } else {
      await enterApp(state.settings);
    }
  } catch (err) {
    console.error('[renderer] boot failed:', err);
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f2f2f2;background:#121212;font-family:sans-serif;text-align:center;padding:20px;">' +
      'Something went wrong starting the app. Please restart it.</div>';
  }
}

// Local mirror of main.js's DEFAULT_PREFS, used only as a fallback if getSettings
// fails entirely (e.g. first-run race) so the UI still has sane values to render.
const DEFAULTS_FALLBACK = {
  theme: 'dark', accentColor: '#e0555a', cardSize: 'medium', readingDirection: 'ltr',
  defaultFit: 'contain', toolbarAutoHide: true, toolbarHideDelay: 2500, animationsEnabled: true,
};

function applyAppearance(settings) {
  const theme = ['dark', 'light'].includes(settings.theme) ? settings.theme : 'dark';
  const direction = ['ltr', 'rtl'].includes(settings.readingDirection) ? settings.readingDirection : 'ltr';
  const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor : '#e0555a';
  document.body.dataset.theme = theme;
  document.body.dataset.readingDirection = direction;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', accent + '22');
  const cardMinMap = { small: '120px', medium: '160px', large: '210px' };
  document.documentElement.style.setProperty('--card-min', cardMinMap[settings.cardSize] || cardMinMap.medium);
  document.body.classList.toggle('no-anim', settings.animationsEnabled === false);
  state.fitMode = FIT_CYCLE.includes(settings.defaultFit) ? settings.defaultFit : 'contain';
  updateSettingsUI(settings);
}

async function enterApp(settings) {
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');

  state.settings = { ...DEFAULTS_FALLBACK, ...settings };
  applyAppearance(state.settings);

  $('#library-folder-path').textContent = settings.libraryFolder || 'Not set';
  $('#pin-toggle').checked = !!settings.pinEnabled;

  await refreshLibrary();
  await refreshHistory();
  bindEvents();
}

// ---------- Lock screen ----------

let pinBuffer = '';
function showLockScreen() {
  $('#lock-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  renderPinDots();
  $$('.pin-key').forEach((btn) => {
    btn.onclick = () => handlePinKey(btn.dataset.key);
  });
}

function renderPinDots() {
  const dots = $('#pin-dots');
  dots.innerHTML = '';
  const len = Math.max(pinBuffer.length, 4);
  for (let i = 0; i < len; i++) {
    const d = document.createElement('span');
    if (i < pinBuffer.length) d.classList.add('filled');
    dots.appendChild(d);
  }
}

async function handlePinKey(key) {
  if (key === 'clear') { pinBuffer = ''; renderPinDots(); return; }
  if (key === 'back') { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
  if (pinBuffer.length >= 6) return;
  pinBuffer += key;
  renderPinDots();
  if (pinBuffer.length >= 4) {
    const ok = await window.api.pinVerify(pinBuffer);
    if (ok) {
      pinBuffer = '';
      const settings = await window.api.getSettings();
      await enterApp(settings);
    } else if (pinBuffer.length === 6) {
      $('#pin-error').classList.remove('hidden');
      $('.lock-card').classList.add('shake');
      setTimeout(() => $('.lock-card').classList.remove('shake'), 320);
      pinBuffer = '';
      renderPinDots();
    }
  }
}

// ---------- Library ----------

async function refreshLibrary() {
  const res = await safeInvoke(window.api.scanLibrary(), null, 'Could not scan your library folder.');
  let books = res ? res.books || [] : await safeInvoke(window.api.getLibrary(), [], 'Could not load your library.');
  if (res && res.skipped && res.skipped.length) {
    showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
  }
  state.books = books;
  updateCategoryFilter(state.books);
  state.history = await safeInvoke(window.api.getHistory(), {}, 'Could not load reading history.');
  renderLibraryGrid(state.books);
}

function renderLibraryGrid(books, filter = '') {
  const grid = $('#library-grid');
  const empty = $('#empty-state');
  const filtered = books.filter((book) => {
    const matchesSearch = !filter || book.title.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = state.category === 'all' || (book.category || 'Uncategorized') === state.category;
    return matchesSearch && matchesCategory;
  });

  if (!books.length) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';
  filtered.forEach((book) => grid.appendChild(bookCard(book)));
}

function updateCategoryFilter(books) {
  const select = $('#category-filter');
  const categories = [...new Set(books.map((book) => book.category || 'Uncategorized'))].sort();
  select.innerHTML = '<option value="all">All categories</option>';
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
  select.value = categories.includes(state.category) ? state.category : 'all';
  state.category = select.value;
}

function bookCard(book) {
  const card = document.createElement('div');
  card.className = 'book-card';
  const hist = state.history[book.id];
  const percent = hist ? Math.round((hist.percent || 0) * 100) : 0;
  const isNew = !hist;

  card.innerHTML = `
    <div class="cover-wrap">
      <div class="cover-placeholder cover-loading">📕</div>
      ${isNew ? '<div class="badge-new">NEW</div>' : ''}
      ${percent > 0 ? `<div class="progress-bar" style="width:${percent}%"></div>` : ''}
    </div>
    <div class="book-title">${escapeHtml(book.title)}</div>
    <div class="book-meta">${book.pageCount} page${book.pageCount === 1 ? '' : 's'} · ${escapeHtml(book.category || 'Uncategorized')}${percent ? ` · ${percent}%` : ''}</div>
  `;

  // Covers are pre-cached on disk by the main process; we never keep the
  // placeholder image src pointed at a fake/invalid path — the placeholder
  // icon stays until (and unless) a real cover successfully loads.
  if (book.cover) {
    loadCoverImage(book).then((src) => {
      if (!src) return;
      const wrap = card.querySelector('.cover-wrap');
      const placeholder = wrap.querySelector('.cover-loading');
      const img = new Image();
      img.alt = '';
      img.onload = () => { placeholder.replaceWith(img); };
      img.onerror = () => { placeholder.textContent = '📕'; };
      img.src = src;
    });
  }

  card.addEventListener('click', () => openReader(book.id));
  return card;
}

const coverCache = {};
async function loadCoverImage(book) {
  if (coverCache[book.id]) return coverCache[book.id];
  const src = await safeInvoke(window.api.getCover(book.id), null, '');
  if (src) coverCache[book.id] = src;
  return src;
}

// ---------- History / Continue reading ----------

async function refreshHistory() {
  state.history = await safeInvoke(window.api.getHistory(), state.history, 'Could not load reading history.');
  const entries = Object.entries(state.history)
    .filter(([id]) => state.books.find((b) => b.id === id))
    .sort((a, b) => (b[1].lastReadAt || 0) - (a[1].lastReadAt || 0));

  const grid = $('#history-grid');
  const empty = $('#history-empty');
  if (!entries.length) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';
  entries.forEach(([id]) => {
    const book = state.books.find((b) => b.id === id);
    if (book) grid.appendChild(bookCard(book));
  });
}

// ---------- Reader ----------

async function openReader(bookId) {
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
  state.currentBook = opened.book;
  state.currentPages = opened.pages;
  state.currentIndex = Math.min(Math.max(opened.resumePage, 0), opened.pages.length - 1);

  $('#reader').classList.remove('hidden');
  $('#reader-title').textContent = opened.book.title;
  state.fitMode = state.settings.defaultFit || 'contain';
  applyFitMode();
  if (window.showReaderToolbar) window.showReaderToolbar();
  await renderCurrentPage();
}

async function renderCurrentPage() {
  const { currentBook, currentPages, currentIndex } = state;
  if (!currentBook || !currentPages.length) return;
  const src = await safeInvoke(
    window.api.getPage(currentBook.id, currentPages[currentIndex]),
    null,
    "Couldn't load this page."
  );
  if (src) $('#reader-page').src = src;
  $('#reader-counter').textContent = `${currentIndex + 1} / ${currentPages.length}`;
  const percent = (currentIndex + 1) / currentPages.length;
  await safeInvoke(window.api.saveProgress(currentBook.id, currentIndex, percent), false, '');
}

function closeReader() {
  $('#reader').classList.add('hidden');
  refreshLibrary();
  refreshHistory();
}

function nextPage() {
  if (state.currentIndex < state.currentPages.length - 1) {
    state.currentIndex++;
    renderCurrentPage();
  }
}
function prevPage() {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    renderCurrentPage();
  }
}

// ---------- Settings ----------

// Reflects the current in-memory settings onto every settings control
// (segmented buttons, toggles, slider, swatches) — called on boot and after
// any change so the UI never drifts from stored state.
function updateSettingsUI(settings) {
  $$('.segmented[data-setting]').forEach((group) => {
    const key = group.dataset.setting;
    $$('.seg-btn', group).forEach((btn) => btn.classList.toggle('active', btn.dataset.value === settings[key]));
  });

  const animToggle = $('#animations-toggle');
  if (animToggle) animToggle.checked = settings.animationsEnabled !== false;

  const autoHideToggle = $('#toolbar-autohide-toggle');
  if (autoHideToggle) autoHideToggle.checked = settings.toolbarAutoHide !== false;

  const delayRow = $('#toolbar-delay-row');
  if (delayRow) delayRow.style.opacity = settings.toolbarAutoHide === false ? '0.4' : '1';
  const delaySlider = $('#toolbar-delay');
  if (delaySlider) {
    delaySlider.value = settings.toolbarHideDelay || 2500;
    delaySlider.disabled = settings.toolbarAutoHide === false;
  }
  const delayLabel = $('#toolbar-delay-label');
  if (delayLabel) delayLabel.textContent = `${((settings.toolbarHideDelay || 2500) / 1000).toFixed(1)}s`;

  renderAccentSwatches(settings.accentColor);
  const customInput = $('#accent-custom');
  if (customInput) customInput.value = settings.accentColor || '#e0555a';
}

function renderAccentSwatches(activeColor) {
  const wrap = $('#accent-swatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  ACCENT_PRESETS.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (color.toLowerCase() === (activeColor || '').toLowerCase() ? ' active' : '');
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => updateSetting('accentColor', color));
    wrap.appendChild(btn);
  });
}

// Single write-path for every customizable preference: persists via IPC,
// updates in-memory state, and re-applies appearance so the change is
// visible immediately without a restart.
async function updateSetting(key, value) {
  const ok = await safeInvoke(window.api.setSetting(key, value), false, "Couldn't save that setting.");
  if (!ok) return;
  state.settings[key] = value;
  applyAppearance(state.settings);
}

// ---------- Tabs ----------

function switchTab(tab) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${tab}`).classList.remove('hidden');
  if (tab === 'history') refreshHistory();
}

// ---------- Utilities ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Event binding ----------

function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#search').addEventListener('input', (e) => renderLibraryGrid(state.books, e.target.value));
  $('#category-filter').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderLibraryGrid(state.books, $('#search').value);
  });

  $('#pick-folder').addEventListener('click', pickFolder);
  $('#pick-folder-empty').addEventListener('click', pickFolder);
  $('#rescan').addEventListener('click', async () => {
    const res = await safeInvoke(window.api.scanLibrary(), null, "Couldn't rescan your library.");
    if (!res) return;
    state.books = res.books || [];
    updateCategoryFilter(state.books);
    renderLibraryGrid(state.books);
    if (res.skipped && res.skipped.length) showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
  });

  // Every segmented control (theme, cover size, reading direction, fit mode)
  // shares one handler: read data-setting off the group, data-value off the button.
  $$('.segmented[data-setting]').forEach((group) => {
    const key = group.dataset.setting;
    $$('.seg-btn', group).forEach((btn) => {
      btn.addEventListener('click', () => updateSetting(key, btn.dataset.value));
    });
  });

  $('#accent-custom').addEventListener('input', (e) => updateSetting('accentColor', e.target.value));

  $('#animations-toggle').addEventListener('change', (e) => updateSetting('animationsEnabled', e.target.checked));

  $('#toolbar-autohide-toggle').addEventListener('change', (e) => updateSetting('toolbarAutoHide', e.target.checked));
  $('#toolbar-delay').addEventListener('input', (e) => {
    $('#toolbar-delay-label').textContent = `${(Number(e.target.value) / 1000).toFixed(1)}s`;
  });
  $('#toolbar-delay').addEventListener('change', (e) => updateSetting('toolbarHideDelay', Number(e.target.value)));

  $('#reset-settings').addEventListener('click', async () => {
    if (!confirm('Reset appearance and reading settings to defaults?')) return;
    const defaults = await safeInvoke(window.api.resetSettings(), DEFAULTS_FALLBACK, "Couldn't reset settings.");
    state.settings = { ...DEFAULTS_FALLBACK, ...defaults };
    applyAppearance(state.settings);
    showToast('Settings reset to defaults.');
  });

  $('#github-link').addEventListener('click', () => {
    window.api.openExternal('https://github.com/izumicancode');
  });

  $('#pin-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      openPinSetup('set');
    } else {
      // Revert immediately; the modal will re-check it on success.
      e.target.checked = true;
      openPinSetup('disable');
    }
  });

  $('#reader-back').addEventListener('click', closeReader);
  $('#reader-next').addEventListener('click', () => turnPage('next'));
  $('#reader-prev').addEventListener('click', () => turnPage('prev'));
  $('#reader-fit').addEventListener('click', cycleFitMode);
  $('#reader-fullscreen').addEventListener('click', async () => {
    const isFullscreen = await safeInvoke(window.api.toggleFullscreen(), false, "Couldn't toggle fullscreen.");
    $('#reader-fullscreen').textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  });
  $('#clear-history').addEventListener('click', async () => {
    if (!confirm('Clear all reading history?')) return;
    const ok = await safeInvoke(window.api.clearHistory(), false, "Couldn't clear reading history.");
    if (ok) {
      state.history = {};
      renderLibraryGrid(state.books, $('#search').value);
      refreshHistory();
      showToast('Reading history cleared.');
    }
  });

  document.addEventListener('keydown', (e) => {
    if ($('#reader').classList.contains('hidden')) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'd') turnPage(state.settings.readingDirection === 'rtl' ? 'prev' : 'next');
    if (key === 'arrowleft' || key === 'a') turnPage(state.settings.readingDirection === 'rtl' ? 'next' : 'prev');
    if (key === 'f' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      $('#reader-fullscreen').click();
    } else if (key === 'f') cycleFitMode();
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

// Reading direction determines what "next"/"forward" means, so both the
// buttons and the keyboard shortcuts route through this single function.
function turnPage(direction) {
  if (direction === 'next') nextPage(); else prevPage();
}

function cycleFitMode() {
  const idx = FIT_CYCLE.indexOf(state.fitMode);
  state.fitMode = FIT_CYCLE[(idx + 1) % FIT_CYCLE.length];
  applyFitMode();
}

function applyFitMode() {
  const img = $('#reader-page');
  FIT_CYCLE.forEach((m) => img.classList.remove(`fit-${m}`));
  if (state.fitMode !== 'contain') img.classList.add(`fit-${state.fitMode}`);
  $('#reader-fit').textContent = FIT_LABELS[state.fitMode];
}

function pickFolder() {
  safeInvoke(window.api.chooseLibraryFolder(), null, "Couldn't choose a library folder.").then(async (folder) => {
    if (!folder) return;
    const res = await safeInvoke(window.api.scanLibrary(), null, "Couldn't scan the selected library folder.");
    if (!res) return;
    $('#library-folder-path').textContent = folder;
    state.books = res.books || [];
    updateCategoryFilter(state.books);
    renderLibraryGrid(state.books, $('#search').value);
    if (res.skipped && res.skipped.length) showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
  });
}

// ---------- PIN setup modal ----------

let pinSetupMode = 'set';
function openPinSetup(mode) {
  pinSetupMode = mode;
  $('#pin-setup-title').textContent = mode === 'set' ? 'Set a PIN' : 'Enter current PIN to disable lock';
  $('#pin-setup-input').placeholder = mode === 'set' ? 'Enter 4–6 digit PIN' : 'Current PIN';
  $('#pin-setup-modal').classList.remove('hidden');
  $('#pin-setup-input').value = '';
  $('#pin-setup-input').focus();
}
function closePinSetup() {
  $('#pin-setup-modal').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  $('#pin-setup-cancel').addEventListener('click', () => {
    closePinSetup();
    if (pinSetupMode === 'set') $('#pin-toggle').checked = false;
  });

  $('#pin-setup-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#pin-setup-confirm').click();
  });

  $('#pin-setup-confirm').addEventListener('click', async () => {
    const val = $('#pin-setup-input').value.trim();
    if (!/^\d{4,6}$/.test(val)) {
      showToast('PIN must be 4–6 digits.');
      return;
    }

    if (pinSetupMode === 'set') {
      const ok = await safeInvoke(window.api.pinSet(val), false, "Couldn't set PIN. Try again.");
      if (ok) {
        closePinSetup();
        showToast('PIN lock enabled.');
      }
    } else {
      const ok = await safeInvoke(window.api.pinDisable(val), false, "Couldn't verify PIN. Try again.");
      if (ok) {
        $('#pin-toggle').checked = false;
        closePinSetup();
        showToast('PIN lock disabled.');
      } else {
        showToast('Incorrect PIN.');
        $('#pin-setup-input').value = '';
        $('#pin-setup-input').focus();
      }
    }
  });

  boot();
});

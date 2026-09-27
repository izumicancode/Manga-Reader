import { state } from './state.js';
import { $, $$, safeInvoke, showToast, updateLibraryStatus, escapeHtml } from './util.js';
import { openReader } from './reader.js';

export async function refreshLibrary() {
  updateLibraryStatus('Scanning library…', 'active');
  const res = await safeInvoke(window.api.scanLibrary(), null, 'Could not scan your library folder.');
  const books = res ? res.books || [] : await safeInvoke(window.api.getLibrary(), [], 'Could not load your library.');
  if (res && res.skipped && res.skipped.length) {
    showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
  }
  state.books = books;
  updateCategoryFilter(state.books);
  state.history = await safeInvoke(window.api.getHistory(), {}, 'Could not load reading history.');
  renderLibraryGrid(state.books);
  updateLibraryStatus(`${books.length} titles loaded`, books.length ? 'success' : 'neutral');
}

export function renderLibraryGrid(books, filter = '') {
  const grid = $('#library-grid');
  const empty = $('#empty-state');
  const filtered = books.filter((book) => {
    const matchesSearch = !filter || book.title.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = state.category === 'all' || (book.category || 'Uncategorized') === state.category;
    const matchesStatus = state.status === 'all'
      || (state.status === 'favorites' && book.favorite)
      || (state.status === 'unread' && !state.history[book.id]);
    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    if (state.sort === 'favorites') return Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title);
    if (state.sort === 'progress') return (state.history[b.id]?.percent || 0) - (state.history[a.id]?.percent || 0);
    if (state.sort === 'recent') return (state.history[b.id]?.lastReadAt || 0) - (state.history[a.id]?.lastReadAt || 0);
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });

  if (!books.length || !filtered.length) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    const hasLibrary = books.length > 0;
    $('#empty-state-title').textContent = hasLibrary ? 'No titles match these filters' : 'Your library is ready';
    $('#empty-state-message').textContent = hasLibrary
      ? 'Try a different search, category, or reading status.'
      : 'Choose the folder that contains your manga. Subfolders and ZIP, CBZ, RAR, and CBR files are supported.';
    $('#pick-folder-empty').classList.toggle('hidden', hasLibrary);
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  // Reuse existing card nodes where possible instead of nuking and rebuilding
  // the whole grid on every filter keystroke — cheaper for the layout/paint
  // engine and keeps `content-visibility: auto` (see styles.css) from having
  // to re-measure everything at once.
  const frag = document.createDocumentFragment();
  filtered.forEach((book) => frag.appendChild(bookCard(book)));
  grid.replaceChildren(frag);
}

export function updateCategoryFilter(books) {
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
  const coverUrl = book.cover ? window.api.coverUrl(book.id, book.mtimeMs) : '';

  card.innerHTML = `
    <div class="cover-wrap">
      ${coverUrl
        ? `<img class="cover-img" src="${coverUrl}" alt="" loading="lazy" decoding="async" />`
        : `<div class="cover-placeholder">📕</div>`}
      <button class="favorite-btn${book.favorite ? ' active' : ''}" title="${book.favorite ? 'Remove favorite' : 'Add favorite'}">${book.favorite ? '★' : '☆'}</button>
      ${isNew ? '<div class="badge-new">NEW</div>' : ''}
      ${percent > 0 ? `<div class="progress-bar" style="width:${percent}%"></div>` : ''}
    </div>
    <div class="book-title">${escapeHtml(book.title)}</div>
    <div class="book-meta">${book.pageCount} page${book.pageCount === 1 ? '' : 's'} · ${escapeHtml(book.category || 'Uncategorized')}${percent ? ` · ${percent}%` : ''}</div>
  `;

  const coverImg = card.querySelector('.cover-img');
  if (coverImg) {
    coverImg.addEventListener('load', () => coverImg.classList.add('loaded'), { once: true });
    coverImg.addEventListener('error', () => {
      coverImg.replaceWith(Object.assign(document.createElement('div'), { className: 'cover-placeholder', textContent: '📕' }));
    }, { once: true });
  }

  card.addEventListener('click', () => openReader(book.id));
  card.querySelector('.favorite-btn').addEventListener('click', async (event) => {
    event.stopPropagation();
    const favorite = await safeInvoke(window.api.toggleFavorite(book.id), book.favorite, "Couldn't update favorite.");
    book.favorite = favorite;
    renderLibraryGrid(state.books, $('#search').value);
  });
  return card;
}

export async function refreshHistory() {
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
  const frag = document.createDocumentFragment();
  entries.forEach(([id]) => {
    const book = state.books.find((b) => b.id === id);
    if (book) frag.appendChild(bookCard(book));
  });
  grid.replaceChildren(frag);
}

export function pickFolder() {
  safeInvoke(window.api.chooseLibraryFolder(), null, "Couldn't choose a library folder.").then(async (folder) => {
    if (!folder) return;
    updateLibraryStatus('Scanning selected folder…', 'active');
    const res = await safeInvoke(window.api.scanLibrary(), null, "Couldn't scan the selected library folder.");
    if (!res) return;
    $('#library-folder-path').textContent = folder;
    state.books = res.books || [];
    updateCategoryFilter(state.books);
    renderLibraryGrid(state.books, $('#search').value);
    if (res.skipped && res.skipped.length) showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
    updateLibraryStatus(`${state.books.length} titles loaded`, state.books.length ? 'success' : 'neutral');
  });
}

export function bindLibraryEvents() {
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderLibraryGrid(state.books, e.target.value), 80);
  });
  $('#category-filter').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderLibraryGrid(state.books, $('#search').value);
  });
  $('#status-filter').addEventListener('change', (e) => {
    state.status = e.target.value;
    renderLibraryGrid(state.books, $('#search').value);
  });
  $('#sort-filter').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderLibraryGrid(state.books, $('#search').value);
  });

  $('#pick-folder').addEventListener('click', pickFolder);
  $('#pick-folder-empty').addEventListener('click', pickFolder);
  $('#rescan').addEventListener('click', async () => {
    updateLibraryStatus('Rescanning…', 'active');
    const res = await safeInvoke(window.api.scanLibrary(), null, "Couldn't rescan your library.");
    if (!res) return;
    state.books = res.books || [];
    updateCategoryFilter(state.books);
    renderLibraryGrid(state.books);
    if (res.skipped && res.skipped.length) showToast(`Skipped ${res.skipped.length} file(s) that couldn't be read.`);
    updateLibraryStatus(`${state.books.length} titles loaded`, state.books.length ? 'success' : 'neutral');
  });

  $('#clear-history').addEventListener('click', () => {
    state.history = {};
    renderLibraryGrid(state.books, $('#search').value);
    $('#history-grid').innerHTML = '';
    $('#history-grid').classList.add('hidden');
    $('#history-empty').classList.remove('hidden');
    window.api.clearHistory().catch((err) => console.error('[history] clear failed:', err));
  });
}

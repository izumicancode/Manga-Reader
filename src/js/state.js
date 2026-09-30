export const state = {
  books: [],
  history: {},
  currentBook: null,
  currentPages: [],
  currentIndex: 0,
  settings: {},
  fitMode: 'contain',
  category: 'all',
  status: 'all',
  sort: 'title',
  zoom: 1,
  spread: false,
  bookmarks: [],
};

// Local mirror of main.js's DEFAULT_PREFS, used only as a fallback if
// getSettings fails entirely (e.g. first-run race) so the UI still has sane
// values to render.
export const DEFAULTS_FALLBACK = {
  theme: 'dark',
  accentColor: '#e0555a',
  cardSize: 'medium',
  readingDirection: 'ltr',
  defaultFit: 'contain',
  toolbarAutoHide: true,
  toolbarHideDelay: 2500,
  animationsEnabled: true,
};

export const ACCENT_PRESETS = ['#e0555a', '#e08a3c', '#d8c445', '#5fb87a', '#4a9fd8', '#8a6fd8', '#d85fa8'];
export const FIT_LABELS = { contain: 'Fit: Page', width: 'Fit: Width', height: 'Fit: Height', original: 'Fit: Original' };
export const FIT_CYCLE = ['contain', 'width', 'height', 'original'];

// A minimal pub/sub so reader.js and library.js don't need to import each
// other directly. Keeps each module independently readable/testable.
export const bus = new EventTarget();

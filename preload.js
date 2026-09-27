const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  chooseLibraryFolder: () => invoke('choose-library-folder'),
  getSettings: () => invoke('get-settings'),
  setSetting: (key, value) => invoke('set-setting', key, value),
  resetSettings: () => invoke('reset-settings'),
  openExternal: (url) => invoke('open-external', url),
  scanLibrary: () => invoke('scan-library'),
  onLibraryChanged: (callback) => ipcRenderer.on('library-changed', callback),
  getLibrary: () => invoke('get-library'),
  toggleFavorite: (bookId) => invoke('toggle-favorite', bookId),
  openBook: (bookId) => invoke('open-book', bookId),
  saveProgress: (bookId, page, percent) => invoke('save-progress', bookId, page, percent),
  toggleBookmark: (bookId, page) => invoke('toggle-bookmark', bookId, page),
  getHistory: () => invoke('get-history'),
  clearHistory: () => invoke('clear-history'),
  toggleFullscreen: () => invoke('toggle-fullscreen'),
  pinStatus: () => invoke('pin-status'),
  pinSet: (pin) => invoke('pin-set', pin),
  pinDisable: (pin) => invoke('pin-disable', pin),
  pinVerify: (pin) => invoke('pin-verify', pin),

  // Covers and pages are served directly by the main process over the
  // `cover://` and `page://` schemes (see main.js) instead of being fetched
  // over IPC as base64 strings. These helpers just build the URL — loading
  // the bytes is left to the <img> element and Chromium's own image
  // pipeline (caching, decoding, prioritization) instead of the app
  // reinventing all of that on top of IPC.
  coverUrl: (bookId, mtimeMs) => `cover://${bookId}/${mtimeMs || 0}`,
  pageUrl: (bookId, mtimeMs, pageName) => `page://${bookId}/${mtimeMs || 0}/${encodeURIComponent(pageName)}`,
});

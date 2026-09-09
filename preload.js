const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseLibraryFolder: () => ipcRenderer.invoke('choose-library-folder'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scanLibrary: () => ipcRenderer.invoke('scan-library'),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  toggleFavorite: (bookId) => ipcRenderer.invoke('toggle-favorite', bookId),
  getCover: (bookId) => ipcRenderer.invoke('get-cover', bookId),
  openBook: (bookId) => ipcRenderer.invoke('open-book', bookId),
  getPage: (bookId, pageName) => ipcRenderer.invoke('get-page', bookId, pageName),
  saveProgress: (bookId, page, percent) => ipcRenderer.invoke('save-progress', bookId, page, percent),
  toggleBookmark: (bookId, page) => ipcRenderer.invoke('toggle-bookmark', bookId, page),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  pinStatus: () => ipcRenderer.invoke('pin-status'),
  pinSet: (pin) => ipcRenderer.invoke('pin-set', pin),
  pinDisable: (pin) => ipcRenderer.invoke('pin-disable', pin),
  pinVerify: (pin) => ipcRenderer.invoke('pin-verify', pin),
});

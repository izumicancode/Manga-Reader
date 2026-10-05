import { contextBridge, ipcRenderer } from 'electron'
import type { Prefs, Settings, ScanResult, Book, History, OpenBookResult } from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api = {
  platform: process.platform,
  chooseLibraryFolder: () => invoke<string | null>('choose-library-folder'),
  getSettings: () => invoke<Settings>('get-settings'),
  setSetting: <K extends keyof Prefs>(key: K, value: Prefs[K]) => invoke<boolean>('set-setting', key, value),
  resetSettings: () => invoke<Prefs>('reset-settings'),
  openExternal: (url: string) => invoke<boolean>('open-external', url),
  scanLibrary: () => invoke<ScanResult>('scan-library'),
  getLibrary: () => invoke<Book[]>('get-library'),
  onLibraryChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('library-changed', listener)
    return () => ipcRenderer.removeListener('library-changed', listener)
  },
  toggleFavorite: (id: string) => invoke<boolean | null>('toggle-favorite', id),
  openBook: (id: string) => invoke<OpenBookResult>('open-book', id),
  saveProgress: (id: string, page: number, percent: number) => invoke<boolean>('save-progress', id, page, percent),
  toggleBookmark: (id: string, page: number) => invoke<boolean | null>('toggle-bookmark', id, page),
  getHistory: () => invoke<History>('get-history'),
  clearHistory: () => invoke<boolean>('clear-history'),
  toggleFullscreen: () => invoke<boolean>('toggle-fullscreen'),
  onFullscreenChange: (cb: (fullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean): void => cb(fullscreen)
    ipcRenderer.on('fullscreen-changed', listener)
    return () => { ipcRenderer.removeListener('fullscreen-changed', listener) }
  },
  pinStatus: () => invoke<{ enabled: boolean }>('pin-status'),
  pinSet: (pin: string) => invoke<boolean>('pin-set', pin),
  pinDisable: (pin: string) => invoke<boolean>('pin-disable', pin),
  pinVerify: (pin: string) => invoke<boolean>('pin-verify', pin),
  // Images are served by main over cover:// and page:// — these just build URLs.
  coverUrl: (id: string, version: string) => `cover://${id}/${version}`,
  pageUrl: (id: string, version: string, page: string) => `page://${id}/${version}/${encodeURIComponent(page)}`
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)

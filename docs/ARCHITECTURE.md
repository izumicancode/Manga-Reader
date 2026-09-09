# Manga Library — Architecture

## 1. Why Electron (not a web app)

You asked for a *real cross-platform app*, not a browser tab. Requirements that rule out a plain web app:

- **Local filesystem access** — needs to read arbitrary folders of `.cbz` files on disk without upload/server round-trips.
- **Offline-first** — no server, no internet dependency.
- **OS-native packaging** — installable `.exe` / `.dmg` / `.AppImage`, with a dock/taskbar icon, native window chrome, and file-open dialogs.
- **PIN lock that actually protects local data** — needs OS-level storage (userData dir), not `localStorage` in a browser tab anyone can inspect.

Electron gives one JS/HTML/CSS codebase that compiles to native apps for Windows, macOS, and Linux, with full Node.js filesystem access in the main process. (Tauri was considered — smaller binaries, but adds a Rust toolchain requirement for future maintenance; Electron was chosen for simplicity of a single-language stack.)

## 2. Process model

Electron apps have two process types. This matters for security and where code lives:

```
┌─────────────────────────────┐        IPC (contextBridge)       ┌──────────────────────────┐
│         Main process         │ <───────────────────────────────> │      Renderer process     │
│         (main.js)            │                                    │   (src/app.js, UI only)   │
│                               │                                    │                            │
│ • Node.js + full FS access   │                                    │ • Sandboxed, no Node access│
│ • Scans library folder       │                                    │ • Renders library grid,    │
│ • Unzips .cbz (adm-zip)      │                                    │   reader, settings         │
│ • Generates/caches thumbnails│                                    │ • Calls window.api.*       │
│ • Persists settings/history  │                                    │   (exposed via preload.js) │
│   via electron-store (JSON)  │                                    │                            │
│ • Hashes & checks PIN        │                                    │                            │
└───────────────────────────────┘                                  └────────────────────────────┘
```

`preload.js` is the only bridge between them (`contextBridge.exposeInMainWorld`), so the renderer (which loads your HTML/CSS/JS like a webpage) never gets raw `fs`/`require` access — this is the standard Electron security model (`contextIsolation: true`, `nodeIntegration: false`).

## 3. Data flow

1. **First launch** → user picks a "Library Folder" (a folder containing `.cbz` files, subfolders allowed).
2. **Scan** → main process walks the folder, finds every `.cbz`, reads basic metadata (filename → title, file size, mtime).
3. **Thumbnail** → for each CBZ, main process opens the zip in memory (`adm-zip`), extracts the first image entry (sorted alphabetically), and writes it to `userData/thumbnails/<hash>.jpg`. Cached after first run — rescans are fast.
4. **Library grid renders** from a JSON index (title, cover path, page count, last-read info).
5. **Opening a book** → main process lists all image entries in the zip (sorted), returns them as an ordered array of `{ index, name }`. Renderer requests page images one at a time via IPC (`get-page`) as base64 — pages aren't all extracted to disk, keeping things fast and avoiding disk bloat.
6. **Reading progress** → every page turn debounced-writes `{ bookId, page, timestamp }` to the history store.
7. **PIN lock** → if enabled, app boots to a lock screen; PIN is stored as a SHA-256 hash (never plaintext) in `electron-store`.

## 4. Storage layout (per-OS `userData` dir)

```
userData/
├── config.json          # electron-store: settings, PIN hash, library folder path
├── library.json          # electron-store: scanned book index (title, path, cover, pages, tags)
├── history.json           # electron-store: { bookId: { page, percent, lastReadAt } }
└── thumbnails/
    └── <bookHash>.jpg     # cached cover images
```

Using `electron-store` (JSON-backed, atomic writes) instead of a database — the dataset is small (a personal library, not millions of rows), so a full SQL engine is unnecessary complexity. If your library grows into the thousands of volumes, swapping `library.json` for `better-sqlite3` is a drop-in future upgrade (same IPC surface, different storage module).

## 5. Module breakdown

| File | Responsibility |
|---|---|
| `main.js` | App lifecycle, window creation, all IPC handlers, filesystem/zip logic, PIN hashing |
| `preload.js` | Whitelists exactly which functions the UI may call — the security boundary |
| `src/index.html` | App shell: lock screen, library view, reader view, settings panel |
| `src/styles.css` | Design tokens (CSS variables) + component styles, light/dark themes |
| `src/app.js` | Renderer logic: view routing, rendering the grid, reader pagination, settings, calling `window.api` |

## 6. Key trade-offs

## 7. Customization system

All user-facing preferences (theme, accent color, cover size, reading direction, default page fit, toolbar behavior, animations) go through one whitelisted preference store rather than ad-hoc settings:

- **`main.js`**: `DEFAULT_PREFS` is the single source of truth for keys and defaults. `set-setting` validates every value against an explicit allow-list (valid hex color, known enum values, boolean/number ranges) before writing — a malformed or malicious value from the renderer can never corrupt `config.json`. This also blocks prototype-pollution-style key injection (e.g. `__proto__`), since only keys in `PREF_KEYS` are ever accepted.
- **`app.js`**: a single `updateSetting(key, value)` write-path persists via IPC, updates in-memory state, and calls `applyAppearance()` to re-render CSS variables and control states immediately — no restart, no page reload.
- **Reset to Defaults** deletes only the preference keys (`reset-settings` IPC), leaving `libraryFolder`, `pinHash`, `library.json`, and `history.json` untouched.

- **No bundler (Webpack/Vite)**: renderer is plain HTML/CSS/vanilla JS. Fewer moving parts, nothing to configure, opens instantly — appropriate for this app's size. If the UI grows significantly, migrating `src/` to a Vite + React setup is straightforward since the IPC contract (`window.api`) stays the same.
- **On-demand page extraction** instead of extracting entire archives to disk: keeps disk usage flat and startup fast, at the cost of a small per-page IPC call (imperceptible for local zip reads).
- **PIN is a deterrent, not encryption**: the CBZ files themselves aren't encrypted on disk — the PIN only gates the *app UI*. This is stated explicitly in Settings so expectations are correct.

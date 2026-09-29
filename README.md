# Manga Library

A cross-platform desktop app for organizing and reading local manga on Windows, macOS, and Linux. Built with Electron, using the same feature set as before — library grid, categories, history, PIN lock, dark and light themes — rewritten for modern standards and speed.

## What changed in this pass

The goal was the same idea as [Mihon](https://github.com/mihonapp/mihon): fast, native-feeling image loading and a UI that stays smooth as your library grows — implemented here in the project's original stack (Electron/JS/HTML/CSS) rather than porting it to Kotlin/Android.

**Image pipeline (the big one).** Every cover and page used to be read on the main process, base64-encoded, and shipped across `ipcRenderer.invoke` as a giant string, then set as a `data:` URI. That's a ~33% size penalty from base64 plus the cost of structured-cloning multi-megabyte strings through IPC on every single page turn. Covers and pages are now served directly by two custom protocols, `cover://` and `page://`, registered in `main.js`. The renderer just points an `<img>` at a URL; Chromium does its normal HTTP-style fetch, caching, and off-main-thread decoding — the same shape as how a native image loader (Coil, which Mihon uses) streams bytes straight into a view.

**No more O(n²) scans.** The old cover-cache check (`extractCoverToCache`) called `fs.readdirSync` on the *entire* thumbnail directory for *every single book* on every scan — for a library of a few thousand titles that's millions of redundant directory reads. The scanner now reads that directory once per scan and reuses the book's already-known cover path when the file hasn't changed.

**Non-blocking scans.** Directory walking and per-file processing now use `fs.promises` and yield to the event loop periodically, so scanning a large library folder no longer freezes window resizing, IPC, or anything else on Electron's single main-process thread"This needs working".

**Event-driven file watching.** The library folder is watched with `fs.watch` instead of polling every 5 seconds; a polling fallback only kicks in on platforms where recursive watching isn't supported.

**GPU acceleration left on.** The previous build force-disabled hardware acceleration app-wide, which mainly helps a narrow set of broken drivers but costs everyone else smoother image scaling and grid animation.

**Renderer rewritten as ES modules.** `src/app.js` (one 722-line file with everything global) is now `src/js/{state,util,library,reader,settings,app}.js` — small, single-purpose modules communicating through an explicit state object and a tiny event bus instead of implicit globals.

**Reader improvements.** Adjacent pages are prefetched a couple pages ahead (and one behind) so flipping forward feels instant instead of popping in. Swipe/drag gestures turn pages, in addition to the existing keyboard shortcuts and buttons.

**Rendering performance.** Library cards use `content-visibility: auto`, so cards scrolled out of view cost nothing to lay out or paint — the CSS equivalent of a virtualized list, without needing to hand-roll one. Covers use native `loading="lazy"` + `decoding="async"`. `prefers-reduced-motion` is now respected at the OS level regardless of the in-app animation toggle.

Feature set, settings, keyboard shortcuts, and data on disk (config/library/history stores, thumbnail cache) are all unchanged and compatible with the previous version.

## Getting started

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

On first launch, click **Choose Library Folder** and select the folder that contains your manga. Subfolders are scanned automatically.

## Building an installable app

```bash
npm run dist
```

Generates native installers in `release/` via `electron-builder`: `.exe` (Windows/NSIS), `.dmg` (macOS), `.AppImage`/`.deb` (Linux). Run on the target OS or use a CI matrix.

## Project structure

```text
manga-library-app/
├── main.js              # Electron main process: filesystem, CBZ/CBR handling, IPC, PIN,
│                         #   and the cover:// / page:// image protocols
├── preload.js            # Secure bridge exposing window.api to the UI
├── src/
│   ├── index.html         # App shell (library, reader, settings, lock screen)
│   ├── styles.css          # Design tokens and component styles (dark and light)
│   └── js/
│       ├── state.js         # Shared state + event bus
│       ├── util.js          # DOM/IPC helpers
│       ├── library.js       # Library grid, filters, favorites, continue reading
│       ├── reader.js        # Page turning, zoom/fit/spread, preloading, swipe gestures
│       ├── settings.js      # Appearance/reading settings, PIN setup modal
│       └── app.js           # Boot sequence, lock screen, tabs — entry point
├── docs/
│   ├── ARCHITECTURE.md
│   └── DESIGN_SYSTEM.md
└── release/               # Generated installable builds
```

## A note on the PIN lock

The PIN only guards the app UI — it does not encrypt files on disk. Anyone with direct filesystem access to your library folder can still open the archives outside the app.

## Credits

Built by **Izumi** — [github.com/izumicancode](https://github.com/izumicancode)

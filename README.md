# Manga Library

A cross-platform desktop app (Windows / macOS / Linux) for organizing and reading local manga — with a cover-art library grid, categories, "Continue Reading" history, dark/light mode, and an optional PIN lock.

Built with **Electron**, so it's a real installable desktop app, not a browser tab — see `docs/ARCHITECTURE.md` for why and how.

## Features

- 📚 **Library view** — auto-scans a folder (and subfolders) for image folders, standalone images, `.zip`, `.cbz`, `.rar`, and `.cbr` files. Folder names are used as manga titles, with the first subfolder used as a category.
- 📖 **Built-in reader** — click a book to read; arrow keys / A-D to page, `F` to cycle fit mode, Esc to exit.
- ⏱ **History / Continue Reading** — remembers your last page per book, with a progress bar on each cover.
- 🗂 **Categories** — filter the library by its containing folder category.
- ⭐ **Organization** — favorite books and sort by title, recent progress, reading progress, or favorites.
- 🧹 **Clear history** — remove all saved reading progress from Settings.
- ⛶ **Fullscreen reader** — use the reader control or `Ctrl+Shift+F`.
- 🔍 **Reader tools** — zoom, bookmarks, and double-page spread mode.
- 🎨 **Fully customizable appearance** — theme, accent color (presets or any custom color), cover size, animation toggle.
- 📖 **Fully customizable reading** — LTR/RTL reading direction (for traditional manga order), default page fit, toolbar auto-hide on/off with adjustable delay.
- 🔒 **PIN lock** — optional 4–6 digit PIN gate on app launch (see Security note below).
- 🔎 **Search** — filter your library by title.
- ↩️ **Reset to defaults** — one click restores appearance/reading settings without touching your library or history.
- 100% offline — no account, no internet connection required.
## Customization

All under **Settings**:

| Setting | Options |
|---|---|
| Theme | Dark / Light |
| Accent color | 7 presets, or any custom color via the color picker |
| Cover size | Small / Medium / Large |
| Animations | On / Off |
| Reading direction | Left→Right / Right→Left (manga order) — also flips arrow-key page turning and the reader toolbar layout |
| Default page fit | Fit Page / Fit Width / Fit Height / Original size |
| Toolbar auto-hide | On/off, with a 1–6 second delay slider |

Every change applies instantly — no restart needed. "Reset to Defaults" reverts all of the above without touching your library folder, reading history, or PIN.


## Getting started (run from source)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

On first launch, click **Choose Library Folder** and select the folder where your manga lives (subfolders are scanned too). Covers are generated automatically from the first image and cached, so re-opening the app is instant.

## Building an installable app

```bash
npm run dist
```

This uses `electron-builder` to produce a native installer in `release/`:
- **Windows** → `.exe` (NSIS installer)
- **macOS** → `.dmg`
- **Linux** → `.AppImage` and `.deb`

Run this command on the target OS (or use a CI matrix) — `electron-builder` cross-compiles with caveats, so building on each platform is most reliable.

## Project structure

```
manga-library-app/
├── main.js            # Electron main process (filesystem, CBZ, IPC, PIN)
├── preload.js         # Secure bridge exposing window.api to the UI
├── src/
│   ├── index.html     # App shell (library / reader / settings / lock screen)
│   ├── styles.css     # Design tokens + component styles (dark & light)
│   └── app.js          # Renderer logic
└── docs/
    ├── ARCHITECTURE.md    # System design & data flow
    └── DESIGN_SYSTEM.md   # Colors, type, layout, component specs
```

## A note on the PIN lock

The PIN gates the **app's UI only** — it does not encrypt the `.cbz` files on disk. Anyone with direct filesystem access to your library folder can still open the archives outside this app. This is called out in Settings so there's no false sense of security.

## Credits

Built by **Izumi** — [github.com/izumicancode](https://github.com/izumicancode)

## Roadmap ideas (not yet built)

- CBR/CBR7 (RAR-based) archive support
- Tagging / collections / custom sort order
- Double-page spread view for landscape reading
- Auto-import: watch the library folder for new files instead of manual rescans

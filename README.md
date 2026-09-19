# Manga Library

A cross-platform desktop app for organizing and reading local manga on Windows, macOS, and Linux. It includes a cover-art library grid, category filters, reading history, dark and light themes, and an optional PIN lock.

Built with **Electron**, so it works as a real installable desktop app rather than a browser tab. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and technical overview.

## Features

- 📚 **Library view** — scans a folder and subfolders for manga collections, standalone images, `.zip`, `.cbz`, `.rar`, and `.cbr` files. Folder names become manga titles, and the first subfolder is used as the category.
- 📖 **Built-in reader** — open a title and read it in-app; use the arrow keys or `A` / `D` to page, `F` to cycle fit mode, and `Esc` to exit.
- ⏱ **History and Continue Reading** — remembers your last page per title and shows reading progress on each cover.
- 🗂 **Categories** — filter the library by the containing folder category.
- ⭐ **Organization** — favorite titles and sort by title, recency, reading progress, or favorites.
- 🧹 **Clear history** — remove saved reading progress from Settings.
- ⛶ **Fullscreen reader** — use the built-in reader control or press `Ctrl+Shift+F`.
- 🔍 **Reader tools** — zoom, bookmarks, and double-page spread mode.
- 🎨 **Customizable appearance** — adjust the theme, accent color, cover size, and animation settings.
- 📖 **Customizable reading experience** — choose left-to-right or right-to-left reading direction, default page fit, and toolbar auto-hide timing.
- 🔒 **PIN lock** — optional 4–6 digit PIN gate on app launch (see the note below).
- 🔎 **Search** — filter your library by title.
- 🎯 **Quick filters** — narrow the library to unread or favorite titles and display clear empty states when no matches are found.
- 🔄 **Automatic updates** — detects added, removed, or changed manga files and refreshes the library automatically.
- ↩️ **Reset to defaults** — restore appearance and reading settings in one click without affecting your library or reading history.
- 100% offline — no account, no internet connection required.

## Customization

All settings live under **Settings**:

| Setting | Options |
|---|---|
| Theme | Dark / Light |
| Accent color | 7 presets, or any custom color via the color picker |
| Cover size | Small / Medium / Large |
| Animations | On / Off |
| Reading direction | Left→Right / Right→Left (manga order) — also flips page-turn controls and the reader toolbar layout |
| Default page fit | Fit Page / Fit Width / Fit Height / Original size |
| Toolbar auto-hide | On / Off, with a 1–6 second delay slider |

Every change applies instantly — no restart is needed. **Reset to Defaults** restores all of the above without touching your library folder, reading history, or PIN settings.

## Getting started

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

On first launch, click **Choose Library Folder** and select the folder that contains your manga. Subfolders are scanned automatically. Covers are generated from the first available image and cached locally so reopening the app feels instant.

## Building an installable app

```bash
npm run dist
```

This uses `electron-builder` to generate native installers in the `release/` folder:

- **Windows** → `.exe` (NSIS installer)
- **macOS** → `.dmg`
- **Linux** → `.AppImage` and `.deb`

Run this command on the target OS, or use a CI matrix, since `electron-builder` can cross-compile but is most reliable when built on each platform individually.

## Project structure

```text
manga-library-app/
├── main.js            # Electron main process (filesystem, CBZ handling, IPC, PIN)
├── preload.js         # Secure bridge exposing window.api to the UI
├── src/
│   ├── index.html     # App shell (library, reader, settings, lock screen)
│   ├── styles.css     # Design tokens and component styles (dark and light)
│   └── app.js         # Renderer logic
├── docs/
│   ├── ARCHITECTURE.md    # System design and data flow
│   └── DESIGN_SYSTEM.md   # Colors, type, layout, and component specs
└── release/           # Generated installable builds
```

## A note on the PIN lock

The PIN only guards the **app UI** — it does not encrypt the `.cbz` files on disk. Anyone with direct filesystem access to your library folder can still open the archives outside the app. This is clearly called out in Settings so there is no false sense of security.

## Credits

Built by **Izumi** — [github.com/izumicancode](https://github.com/izumicancode)

## Roadmap ideas

- Tagging and collections
- Custom sort order
- Chapter navigation between related folders or archives
- Drag-and-drop importing

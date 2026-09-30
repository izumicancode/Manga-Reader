# Manga Library

A cross-platform desktop app for organizing and reading local manga (folders, images, ZIP/CBZ, RAR/CBR).
Rebuilt from [izumicancode/Manga-Reader](https://github.com/izumicancode/Manga-Reader) on a modern stack:

- **electron-vite** (main / preload / renderer, HMR in dev)
- **React 18 + TypeScript**
- **Tailwind CSS** + **shadcn/ui** (Radix primitives: Select, Dialog, Switch, Slider, ToggleGroup, Sonner toasts)
- **Framer Motion** (animated tabs via `layoutId`, staggered card entrance, page slide/drag-to-turn, spring toolbar, PIN shake)
- **Zustand** for state

## Run

```bash
npm install
npm run dev        # development with HMR
npm run build      # production build into ./out
npm run dist       # installers into ./release (NSIS / dmg / AppImage+deb)
```

## Structure

```text
src/
├── main/index.ts        # scanning, CBZ/CBR, IPC, PIN, cover:// + page:// protocols
├── preload/index.ts     # typed window.api bridge
├── shared/              # types + defaults shared by main and renderer
└── renderer/src/
    ├── store.ts         # Zustand store (replaces state.js + event bus)
    ├── components/      # TopBar, BookCard, LibraryView, HistoryView, SettingsView, Reader, LockScreen
    └── components/ui/   # shadcn/ui components
```

## Compatibility

Config, library, history and thumbnail data on disk use the same electron-store files and keys as v2,
so existing libraries, progress, bookmarks and PINs carry over.

## Changes vs. the original

- PINs are now hashed with per-install salted `scrypt`. Existing v2 PINs still verify; setting a new PIN upgrades the hash.
- The library watcher's change detection is async instead of a sync recursive walk.
- Cover lookup during scans is an O(1) map lookup.
- Reader: click zones at the screen edges, a progress line, and drag-to-turn with animated page slides.
- Accent color drives shadcn's `--primary` token, so every component follows it.

The PIN only guards the app UI; it does not encrypt files on disk.

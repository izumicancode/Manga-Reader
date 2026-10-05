# Manga Reader

A modern desktop app for organizing and reading local manga collections, built with Electron, React, and Vite.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-30.x-9feaf9.svg)](https://www.electronjs.org/)

Manga Reader indexes local files in place, so choosing a library folder does not upload or duplicate your manga. Browse covers, track reading progress, and read your collection offline.

## Highlights

- Local manga library with fast scanning and indexing
- Supported sources: folders, JPG/JPEG, PNG, WebP, GIF, BMP, AVIF, ZIP/CBZ, and RAR/CBR archives
- Reading progress and history tracking
- Pin-protected lock screen for app access
- Customize the light/dark theme, accent color, cover size, and interface animations
- Built on Electron + Vite for a modern desktop experience

## Features

- Organize a library of manga from local directories
- A folder with images directly inside is one title; folders without direct images are searched recursively for titles
- Categories come from the first folder below the library root; titles stored at the root use `Uncategorized`
- Detect and read archive-based manga volumes
- Pages are ordered naturally by filename, so `page2.jpg` comes before `page10.jpg`
- A title's cover is taken from its first naturally sorted image
- View cover art and metadata during browsing
- Continue reading from saved history and bookmarks
- Save the current page and bookmarks per title; Continue Reading is ordered by most recent progress update
- Choose left-to-right or right-to-left reading and page, width, height, or original-size fitting
- Switch between single-page and double-page spreads; zoom ranges from 50% to 300%
- Reader keys: arrows or `A`/`D` turn pages, `Home`/`End` jump to either end, `F` changes fit, `+`/`-` zoom, `B` toggles a bookmark, `S` toggles spreads, and `T` toggles the toolbar
- Use `Ctrl`/`Cmd`+`Shift`+`F` for fullscreen; `Escape` exits fullscreen or closes the reader
- Toggle between reading controls and a sleek desktop interface
- Keep compatibility with existing stored library and progress data from the previous app version

## Tech Stack

- Electron + Vite
- React 18 + TypeScript
- Tailwind CSS
- shadcn/ui + Radix primitives
- Zustand for state management
- Framer Motion for transitions and animations

## Getting Started

### Prerequisites

- Node.js 18+

- npm

### Install

```bash

npm install

```

### Run in development mode

```bash

npm run dev

```

### Build the app

```bash

npm run build

```

### Package distributables

```bash

npm run dist

```

This creates app packages in the release output folder, depending on the target platform.

## Project Structure

```text
.
├── src/
│   ├── main/                # Electron main process logic
│   ├── preload/             # IPC bridge and typed API exposure
│   ├── shared/              # Shared constants, defaults, and types
│   └── renderer/src/        # React app UI and state
│       ├── components/      # Views and reusable UI components
│       ├── lib/             # Utility helpers
│       ├── App.tsx          # App shell
│       ├── store.ts         # Zustand store
│       └── main.tsx         # Renderer entry
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── LICENSE
├── README.md
└── docs/                   # Design and architecture notes
```

## Compatibility and Migration

The app preserves the same Electron store keys and disk layout used by the previous version, so existing library entries, progress data, bookmarks, and PIN settings can carry over with minimal friction.

## Security Note

The app PIN protects the UI layer but does not encrypt files on disk. It is intended as a local access control mechanism, not a full disk-encryption feature.

## Notes on the Current Implementation

- PINs are hashed with a per-install salted scrypt flow, while older v2 PINs remain compatible for verification.
- The library watcher uses async change detection instead of a synchronous recursive scan.
- Cover lookup is optimized with an O(1) map lookup during scans.
- Reading interactions include edge click zones, progress indicators, and drag-to-turn motion.
- Accent colors flow through the app theme system, updating the UI tokens consistently.

## License

This project is licensed under the [Apache-2.0 License](LICENSE).

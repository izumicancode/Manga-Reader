# Manga Library — Design System

## Principles
1. **Covers are the hero.** Chrome, labels, and buttons stay quiet so thumbnails do the work.
2. **Reading is full-bleed.** The reader view removes all decoration — just the page, with controls that fade in on hover/tap.
3. **Dark by default.** Manga is read in dim rooms; light mode exists for daytime but dark mode is the primary experience.

## Color tokens (CSS variables)

| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#121212` | `#f6f5f3` |
| `--bg-elevated` | `#1c1c1e` | `#ffffff` |
| `--bg-hover` | `#262628` | `#ececea` |
| `--text` | `#f2f2f2` | `#1a1a1a` |
| `--text-muted` | `#9a9a9d` | `#6b6b6e` |
| `--accent` | `#e0555a` | `#c8383e` |
| `--accent-soft` | `#e0555a22` | `#c8383e18` |
| `--border` | `#2c2c2e` | `#e2e0dc` |
| `--danger` | `#e0555a` | `#c8383e` |
| `--success` | `#4caf7d` | `#2e8b57` |

Accent is a warm red-coral — evokes a manga cover-band without being a garish "brand red."

## Typography

- System font stack: `-apple-system, "Segoe UI", Roboto, sans-serif` — native feel on every OS, zero load time.
- Scale: `12 / 13 / 15 / 18 / 24 / 32px`. Titles use `600` weight; body/meta uses `400–500`.
- Book titles truncate to 2 lines (`-webkit-line-clamp: 2`) rather than wrapping the grid.

## Layout

- **Library grid**: responsive `repeat(auto-fill, minmax(160px, 1fr))`, cover aspect ratio locked at `2:3` (standard manga volume proportions), 12px gap.
- **Spacing scale**: `4 / 8 / 12 / 16 / 24 / 32px` — no arbitrary values.
- **Radius**: `10px` for cards, `8px` for buttons/inputs, `999px` for pills/badges.
- **Elevation**: single soft shadow on hover only (`0 8px 24px rgba(0,0,0,.35)` dark / lighter in light mode) — flat otherwise, no card borders doubling as shadows.

## Components

- **Book Card**: cover image, gradient scrim at bottom for title legibility, progress bar (2px, accent color) along the card's bottom edge if partially read, "NEW" pill if unread.
- **Reader Toolbar**: auto-hides after 2.5s of inactivity; reappears on mouse move / tap. Contains: back, page counter (`12 / 34`), fit-toggle (width/height/original), thumbnail-strip toggle.
- **Settings Panel**: grouped cards (Library, Appearance, Security, About), not a flat list — scans as sections, not a wall of toggles.
- **Lock Screen**: centered 4–6 digit PIN dial, large tap targets (44px min per Apple/Google HIG guidance), shake animation on wrong PIN, no hints displayed.

## Motion

- View transitions: 160ms ease-out fade+scale (`0.98 → 1`). Nothing longer — this is a utility app, not a showcase.
- Page turns in reader: instant (no animation) by default — matches how people actually read manga fast; a "page slide" option can be added later for those who want it.

## Accessibility

- All interactive elements are real `<button>`s (keyboard-focusable, `:focus-visible` ring in accent color).
- Contrast: text tokens meet WCAG AA against both `--bg` and `--bg-elevated`.
- Reader supports full keyboard navigation: `←/→` or `A/D` to page, `Esc` to exit, `F` to toggle fit mode.

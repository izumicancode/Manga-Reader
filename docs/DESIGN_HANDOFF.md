# Handoff Spec: Manga Library App

## Overview
A desktop app for browsing and reading a local `.cbz` collection. Three primary surfaces: **Library** (grid of book cards), **Reader** (full-bleed page view), **Settings** (grouped preference cards), plus a **Lock Screen** gate. This spec covers every state so nothing is left to guess — see `docs/DESIGN_SYSTEM.md` for the token definitions referenced below.

---

## Component: Book Card

### Layout
- Grid: `repeat(auto-fill, minmax(160px, 1fr))`, `gap: 20px 16px`, cover locked to `2:3` aspect ratio.
- Card = cover-wrap + title (2-line clamp) + meta line (page count, and `· NN%` if in progress).

### Design tokens used
| Token | Value | Usage |
|---|---|---|
| `--bg-elevated` | card background | card surface, placeholder background (`--bg-hover`) |
| `--accent` | progress bar fill, NEW badge background |
| radius | `10px` | card corners |
| spacing | `8-10px` | title/meta padding |

### States
| State | Behavior |
|---|---|
| **Default** | Cover image, title, meta line. |
| **Loading cover** | Shows `📕` placeholder (`.cover-placeholder`) at 60% opacity immediately; swapped for the real `<img>` only after it has fully decoded (`img.onload`), so there is never a broken-image icon. |
| **Cover fetch fails** | Placeholder emoji remains permanently — never left blank, never shows a broken-image glyph. |
| **Unread** | Small `NEW` pill, top-right of cover. |
| **In progress** | 3px accent progress bar along the bottom edge of the cover, width = read %. `NEW` badge hidden once any history exists. |
| **Hover** | `translateY(-4px)` + soft shadow, 160ms ease-out. |
| **Click** | Opens the Reader for that book. No separate "click to preview" state — single click always opens. |

### Edge cases
- **Very long titles** (e.g. `"The Extremely Long Untranslated Original Japanese Volume Title Vol. 12"`) → clamped to 2 lines with ellipsis (`-webkit-line-clamp: 2`), never pushes card height.
- **Zero-page / corrupt archive** → excluded from the library entirely at scan time (see Library States below) rather than rendered as a broken card.
- **Duplicate filenames in different subfolders** → each gets a distinct ID (hash of full path), so both appear as separate cards; title alone is not assumed unique.

---

## Component: Library View

### States
| State | Trigger | UI |
|---|---|---|
| **Empty — no folder set** | First launch, `libraryFolder` unset | Centered empty state: "No manga found yet." + primary "Choose Library Folder" button. |
| **Empty — folder set, no .cbz found** | Folder picked but contains no valid CBZs | Same empty state (folder picker button re-triggers picking, not rescanning — user likely picked the wrong folder). |
| **Populated** | ≥1 valid book indexed | Grid of Book Cards. |
| **Scanning** | User clicks "Rescan Now" | *(Current implementation scans synchronously; for large libraries a loading indicator on the button — e.g. disable + "Scanning…" label — should be added; flagged as a follow-up, not yet built.)* |
| **Partial scan failure** | Some files corrupt/unreadable | Valid books still render normally; a toast reports `"Skipped N file(s) that couldn't be read."` — the whole scan never fails because of one bad file. |
| **Search active** | Text in search box | Grid filters client-side by title substring match, case-insensitive; empty grid (no "0 results" state yet — follow-up). |

---

## Component: Reader

### Layout
- Full-bleed, `#000` background, page centered with `object-fit: contain` (never crops, never distorts).
- Toolbar is an overlay, bottom-anchored, `linear-gradient(to top, rgba(0,0,0,.85), transparent)`, hidden by default.

### Interaction spec
| Trigger | Behavior |
|---|---|
| Mouse move inside reader | Toolbar fades in (`opacity 0→1`, 200ms), then auto-hides after 2.5s of no movement. |
| `←` / `A` | Previous page (no-op if already on page 1 — does not wrap or throw). |
| `→` / `D` | Next page (no-op if already on last page). |
| `Esc` | Exit to Library; also triggers a library + history refresh so the just-updated progress bar is visible immediately. |
| Click "← Library" | Same as `Esc`. |
| Every page turn | Debounce-free write to history store (`{ page, percent, lastReadAt }}`); intentionally fires every turn rather than throttled, since local disk writes are cheap and this guarantees progress is never lost on an unexpected quit. |

### Error / edge states
| Condition | Behavior |
|---|---|
| File deleted from disk since last scan | Toast: *"That file no longer exists on disk. Try rescanning your library."* — reader never opens on a book it can't read. |
| Archive has 0 readable images | Toast: *"This archive doesn't contain any readable images."* (Also excluded from the library at scan time, so this path is a safety net for edge cases like manual IPC misuse.) |
| Archive unreadable/corrupted | Toast: *"That file couldn't be read — it may be corrupted."* |
| Single page fails to decode/load | Toast: *"Couldn't load this page."* — page counter and toolbar stay functional so the user can still navigate past the bad page. |
| Resume position beyond current page count (e.g. archive changed) | Clamped to `pages.length - 1`, never indexes out of bounds. |

---

## Component: Lock Screen (PIN)

### Layout
- Centered card: icon, "Enter PIN" heading, dot row (min 4 dots, grows visually as digits are entered up to 6), numeric pad, `Clear` / `⌫` ghost buttons.
- Pad buttons: 64×64px circular tap targets (exceeds the 44px HIG minimum).

### Interaction spec
| Input | Behavior |
|---|---|
| Digit tap | Appends to buffer (max 6 digits); dot fills. |
| Buffer reaches ≥4 digits | Silently attempts verification after **every** keystroke from 4 digits onward — so 4, 5, and 6-digit PINs all unlock the instant the correct sequence is typed, without requiring the user to know their own PIN's length in advance. |
| Verification fails and buffer = 6 | Error text shown, card does a 320ms shake, buffer clears. Fails *before* 6 digits are silently ignored (no premature error for a 5-digit PIN typed toward a 6-digit target). |
| `Clear` | Empties buffer, no error shown. |
| `⌫` | Removes last digit. |

### Security notes for engineering
- PIN is never stored in plaintext — SHA-256 hash, and comparisons use `crypto.timingSafeEqual` (constant-time) to avoid leaking match-length via response timing.
- Explicitly **does not** encrypt the underlying `.cbz` files — this is disclosed in the Settings row copy so there's no false sense of security. Do not remove that disclosure copy in future iterations.

---

## Component: Settings — PIN toggle (previously broken, now fixed)

### What was wrong
The original build used `window.prompt()` to ask for the current PIN when disabling the lock. **Electron's renderer does not implement `window.prompt()`** — it returns `null` immediately with no dialog shown, so the toggle silently failed every time. This was very likely the "not working" issue reported.

### Fixed interaction spec
| Trigger | Behavior |
|---|---|
| Toggle **ON** (enabling) | Opens the in-app PIN-setup modal (`#pin-setup-modal`), title *"Set a PIN"*. Confirm requires 4–6 digits (regex-validated on both renderer and main process); `Enter` key submits. On success: modal closes, toast *"PIN lock enabled."* |
| Toggle **OFF** (disabling) | Checkbox visually reverts to checked immediately (never shows a "half-off" state), then opens the same modal in *disable* mode, title *"Enter current PIN to disable lock"*. Correct PIN → toggle turns off, toast *"PIN lock disabled."* Incorrect PIN → toast *"Incorrect PIN."*, input clears and refocuses — modal stays open, user can retry without re-opening it. |
| Cancel (either mode) | Modal closes; if mode was "enable," the toggle reverts to unchecked (no silent partial-enable state). |

---

## Global error handling (app-wide)

Added because a single failed IPC call or file-read must never leave the user stuck on a frozen or blank screen:

- Every `window.api.*` call from the renderer is wrapped in `safeInvoke()`, which catches failures, logs them, and shows a bottom-centered toast rather than throwing into the UI thread.
- `main.js` registers `process.on('uncaughtException'/'unhandledRejection')` so a single bad file or IPC call logs instead of taking down the whole process.
- If the renderer process itself crashes (GPU/OOM), `render-process-gone` catches it and reloads the window with an error dialog, instead of leaving a dead, unresponsive window.
- If `boot()` itself throws for any reason, a plain-text fallback screen renders ("Something went wrong starting the app. Please restart it.") instead of a blank white window — the worst-case failure mode is now legible, not silent.

## Toast component (new)

- Bottom-center, `border-radius: 999px`, appears with `opacity/transform` transition (180ms), auto-dismisses after 3.2s.
- Used for: scan-skip notices, PIN feedback, and any recoverable IPC failure. Never used for destructive-action confirmations (those need an explicit modal, not a self-dismissing toast).

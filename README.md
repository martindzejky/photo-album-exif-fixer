# Old Photos EXIF Fixer

A tiny local SvelteKit app that audits photo EXIF capture dates against album folder names. Each album is a subfolder whose name starts with a date in the form `YYYYMMdd` (e.g., `20101231 New Year`). The app shows album/photo status and can rewrite JPEG EXIF dates to match the album date.

## What this is (and isn’t)

- Local-only, throwaway-style utility built for one-off use. Not polished or production-ready.
- Vibe-coded in Cursor; SvelteKit + Svelte chosen for learning purposes.
- No backend, no auth, no database. Everything happens in your browser against your local files.

## How it works

1. On start, pick a root folder via the browser’s File System Access dialog.
2. The app treats each immediate subfolder as an album and parses the date from its name.
3. It reads EXIF dates from photos and compares them to the album date, showing a clear status.
4. You can run a fix to set the JPEG EXIF date(s) to the album date (preserving time when possible).
5. A detailed log shows exactly what was analyzed and changed.

Notes:

- EXIF writing supports JPEGs only. Other formats are analyzed but not modified.
- Requires a browser with the File System Access API (Chrome or Edge desktop). Safari/Firefox are not supported for writing.

## Running locally

Requirements:

- pnpm installed
- A recent Node LTS (recommended)

Commands:

```bash
pnpm install
pnpm dev
```

Then open the printed local URL in Chrome/Edge, select your root photo folder, and follow the UI.

## Tech stack

- SvelteKit + Svelte 5
- Tailwind CSS 4
- Vite 7
- EXIF tooling: `exifr` (read), `piexifjs` (write)

Decisions & assumptions

- Backups: create `.bak` copies before modifying any file.
- Pages: three pages — select folder, main, album detail.
- Log panel: permanent side panel with a vertical list of entries; no export needed.
- Browser: Chrome (Chromium-based) required due to File System Access API.
- Performance: not a priority.
- File types: only JPG/JPEG supported for writes (others read-only or skipped).
- Timezone: use local system timezone (Bratislava, typically UTC+2 or +1 DST-aware).
- Album naming: strictly `YYYYMMdd` prefix. Warn if a subfolder does not match or lacks a date.
- Albums depth: only immediate subfolders are albums; nested folders inside an album trigger a UI warning.
- Date matching: date-only comparison (ignore time). When fixing, use the photo's existing capture time if present; otherwise default to 12:00 local time.
- Warnings: always display warnings in UI for any deviations (unsupported file types, invalid album names, nested dirs, read/write failures).

EXIF policy (JPG)

- Read tags: `DateTimeOriginal` (primary), fallback `CreateDate` (aka `DateTimeDigitized`), and show `ModifyDate` for reference.
- Write tags: set all three for consistency when fixing:
  - `DateTimeOriginal`
  - `CreateDate` (a.k.a. `DateTimeDigitized`)
  - `ModifyDate`
- Date format written: `YYYY:MM:DD HH:MM:SS` in local time (no timezone offset in classic EXIF).
- Tooling: `exifr` for reads, `piexifjs` for JPG writes (in-browser). Non-JPG files are shown as read-only/unsupported for fix.

Navigation & flow

1. Select Folder page: request directory via File System Access API (readwrite), persist handle.
2. Main page: list albums (immediate subfolders), parse `YYYYMMdd`, summarize statuses, show log panel.
3. Album page: list photos in that album, show EXIF date, computed status, and fix actions.
4. Fix flow: dry-run preview (what will change), then apply with `.bak` backup, re-read to verify, update UI and log.

Validation & rules

- Invalid album name → warn; album still listed but marked as invalid.
- Nested directories under an album → warn prominently.
- Non-JPGs → warn as unsupported for write; include in counts if desired, clearly labeled.
- Concurrency kept simple; ability to cancel operations is nice-to-have but not required.

Open items

- None pending. Proceed with the above unless new preferences arise.

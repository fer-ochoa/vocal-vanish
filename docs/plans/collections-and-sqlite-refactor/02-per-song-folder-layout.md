# Feat 02 — Per-song folder layout (`media/<kid>/`, `tmp/`)

## Goal

Move from "all files flat inside `kara-catalog/`" to "one folder per song under `kara-catalog/media/<kid>/`", with in-flight downloads staged under `kara-catalog/tmp/<kid>.part` instead of `<finalPath>.part` sitting next to finished files. This is the storage-layout half of the refactor (design doc §2), done as its own feat so feat 01 (SQLite swap) and this one each stay small and independently testable.

Functional state after this feat: identical to the user — same search/download/catalog/play/lyricless/delete behavior. Only the on-disk paths change, plus a one-off migration moving any files that exist from before this feat (including ones already imported into SQLite by feat 01, which left them in place).

## Reference

Design doc §2 (folder tree + rationale + filename plan). Depends on feat 01 (needs the `songs` table and `mediaFile` column already in place).

## Scope

### Add
- Path helpers in `src/db/` or a new `src/storage.ts` (pick one and use it consistently — e.g. `src/storage.ts` to keep DB code and filesystem-layout code separate):
  - `mediaDir(kid): string` → `kara-catalog/media/<kid>/`
  - `tmpPartPath(kid): string` → `kara-catalog/tmp/<kid>.part`
  - `ensureMediaDir(kid): void`, `ensureTmpDir(): void`
- Startup cleanup: delete everything under `kara-catalog/tmp/` on app start (design doc §2 — "Startup cleanup is just delete everything under tmp/"). Add this call next to the legacy import call in `app.on("ready", ...)`.
- One-off migration step (extends `src/db/legacy-import.ts`, or a new `src/db/legacy-folder-migration.ts` run right after it): for every row currently in `songs` whose `mediaFile` is **not yet** inside `media/<kid>/` (i.e. still sitting flat in `kara-catalog/`), create `media/<kid>/` and `fs.renameSync` both the main video and the lyricless file (if present) into it. This must run regardless of whether the row came from this feat's predecessor's legacy import or was already native-SQLite (so it's correct both for upgraders and anyone who already has SQLite from feat 01's testing). Idempotent: skip any row whose files are already under `media/<kid>/`.

### Change
- `src/index.ts` (`kara:download`): download target becomes `tmp/<kid>.part`, finalized into `media/<kid>/<hardsubbed_mediafile>` (creating `media/<kid>/` first).
- `src/index.ts` (`kara:write-lyricless`): temp file becomes `tmp/<kid>.part` (or a distinctly-named tmp file if a download could race a lyricless write for the same kid — use e.g. `tmp/<kid>.lyricless.part` to be safe), final file becomes `media/<kid>/lyricless.mp4`.
- `src/index.ts` (`kara:media-stream`): resolve the path via `mediaDir(kid)` + the stored filename instead of `CATALOG_DIR()` + filename.
- `src/index.ts` (`kara:delete`): delete `media/<kid>/` recursively (`fs.rmSync(mediaDir(kid), { recursive: true, force: true })`) instead of unlinking two files individually by name — simpler and correct even if a thumbnail or other per-song file is added later.
- `src/db/queries.ts`: no schema change needed (columns already match); no other change.

### Explicitly not in this feat
- No thumbnail support yet (design doc flags thumbnails as future; just make sure the folder-per-song layout doesn't preclude it, which it doesn't).
- No collections/account work.

## Acceptance criteria

- Fresh install: downloading a song creates `media/<kid>/<hardsubbed_mediafile>`; `tmp/<kid>.part` exists during download and is gone after. Deleting the song removes `media/<kid>/` entirely.
- Upgrade from a feat-01-only install (flat files, SQLite index already in place): on first launch after this feat ships, existing songs' files are moved into `media/<kid>/` with no data loss; Catalog screen keeps working immediately (Play/Lyricless/Delete) against the moved files.
- Killing the app mid-download and restarting: stale `tmp/*.part` files from the dead download are cleared on the next startup; retrying the download works normally.
- `npm run lint` passes; `npm run start` boots with no console errors; manually verified: download → play → generate lyricless → play lyricless → delete, all succeed.

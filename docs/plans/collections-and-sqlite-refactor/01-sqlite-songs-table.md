# Feat 01 — SQLite `songs` table replaces `catalog.json`

## Goal

Swap the backing store for the local song index from `catalog.json` to a SQLite `songs` table (via `better-sqlite3` + Drizzle ORM), with a one-off startup import of any existing `catalog.json`. **No folder-layout change yet** — files stay exactly where they are today (flat inside `kara-catalog/`); only the *index* moves from JSON to SQL. That keeps this feat small and isolated from feat 02.

Functional state after this feat: identical to today from the user's point of view. Search, download, catalog list, play, lyricless generation, delete — all unchanged in behavior, just reading/writing SQLite instead of `catalog.json` under the hood.

## Reference

Design doc §3 (schema + driver/ORM choice), §3.5 (wiring), §6 (legacy import), §7 (file change table) of `docs/collections-and-sqlite-refactor.md`. This feat implements the `songs` table only (not `collections`/`collection_songs`/`account` — those come in later feats, but it's fine/expected to create all four tables' `CREATE TABLE IF NOT EXISTS` statements now in `src/db/index.ts` since they're cheap and idempotent; just don't build any query helpers or IPC for collections/account yet).

## Scope

### Add
- `better-sqlite3`, `drizzle-orm` as dependencies; `@types/better-sqlite3` as a dev dependency. Do **not** add `drizzle-kit`.
- `src/db/schema.ts` — Drizzle table definitions for `songs`, `collections`, `collection_songs`, `account` exactly as specified in design doc §3.3 (defining all four now avoids a churny re-edit of this file in feats 03/04; only `songs` gets used this feat).
- `src/db/index.ts` — opens `library.db` under `app.getPath("userData")/kara-catalog/`, sets `journal_mode = WAL` and `foreign_keys = ON`, runs the idempotent `CREATE TABLE IF NOT EXISTS` DDL for all four tables (design doc §3.5), exports the Drizzle `db` instance.
- `src/db/queries.ts` — song-table query helpers only, for this feat:
  - `getAllSongs(): CatalogEntry[]` (sorted by `downloadedAt` desc, same ordering `kara:catalog` returns today)
  - `getSong(kid: string): CatalogEntry | undefined`
  - `isDownloaded(kid: string): boolean` and `alreadyDownloadedKids(kids: string[]): Set<string>` (design doc §3.6; used by search-row flagging and future dedup)
  - `upsertSong(entry: CatalogEntry): void`
  - `updateLyriclessFile(kid: string, fileName: string): void`
  - `deleteSong(kid: string): void`
  - `backfillSongMetadata(kid: string, langs: string[], offVocal: boolean): void`

  `CatalogEntry` keeps its current shape (`kid, title, series, singer, duration, file, size, downloadedAt, lyriclessFile?, langs?, offVocal?`) at this layer — map `mediaFile`/`mediaSize`/`lyriclessFile` column names to/from the existing field names (`file`/`size`/`lyriclessFile`) inside `queries.ts` so every call site above and below it is untouched.
- `src/db/legacy-import.ts` — one-off import run once at startup, before `registerIpc()`:
  1. If `songs` table already has rows, no-op.
  2. Else if `catalog.json` exists in `kara-catalog/`, read it, insert one `songs` row per `CatalogEntry` (no file moves yet — that's feat 02; `mediaFile` = the entry's existing `file` value, files stay in place).
  3. Rename `catalog.json` → `catalog.json.bak` once the import finishes without error (don't delete it).
  4. If neither condition holds (fresh install, no legacy file), no-op.

### Change
- `src/index.ts`: remove `readIndex()`/`writeIndex()`/`CATALOG_INDEX_FILE` and the flat JSON logic. Every handler that touched the index (`kara:search`'s downloaded-set lookup, `kara:catalog`, `kara:catalog-backfill`, `kara:download`, `kara:media-stream`'s entry lookup, `kara:delete`, `kara:write-lyricless`, `kara:lyricless-status`) now calls the `src/db/queries.ts` helpers instead. Call `legacy-import.ts`'s import function once at the top of `app.on("ready", ...)`, before `registerIpc()`.
- No change to `src/preload.ts`, `src/global.d.ts`, or any `.vue` file — the IPC contract and `CatalogEntry` shape returned to the renderer are identical to today.

### Explicitly not in this feat
- No folder-per-song layout change (feat 02).
- No `collections`/`account` query helpers or IPC handlers (feats 03/04), even though their tables exist in the schema already.
- No `drizzle-kit`, no migration files.

## Notes on packaging

`better-sqlite3` is a native module. `forge.config.ts` already has `AutoUnpackNativesPlugin`, which the design doc (§3.2) confirms exists precisely to handle this — no forge config change needed. Worth a sanity check after `npm install` that `npm run package` (or at minimum `npm run start`) still works with the native binding loaded in Electron's ABI (not plain Node's) — `better-sqlite3` ships prebuilt binaries per Electron version and electron-forge handles the rebuild step automatically on `npm install` via its postinstall life-cycle; if it doesn't, run `npx electron-rebuild` once.

## Acceptance criteria

- Fresh install (no existing `catalog.json`): app starts, `songs` table is empty, search/download/catalog/delete/lyricless all work end to end against SQLite.
- Upgrade path (existing `catalog.json` present from a prior install): on first launch after this feat ships, `catalog.json` is imported into `songs` and renamed to `catalog.json.bak`; the Catalog screen shows the exact same songs as before the upgrade, with working Play/Lyricless/Delete.
- Restarting the app a second time does not re-import or duplicate rows (idempotency check in `legacy-import.ts`).
- `npm run lint` passes; `npm run start` boots with no console errors.

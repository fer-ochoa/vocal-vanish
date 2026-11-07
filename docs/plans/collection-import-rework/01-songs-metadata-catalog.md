# Feat 01 — Songs as a metadata catalog (nullable download columns)

## Goal

`songs` stops meaning "downloaded" and starts meaning "known". `media_file` and `downloaded_at` become nullable; `downloaded` is derived (`media_file !== null`), never stored, so it cannot drift. Deleting a song's download clears those columns instead of deleting the row, so collection membership survives and the song renders as "Not Downloaded".

## Reference

- Overview decision 2 (deleting a song from a collection does not remove it from the collection — the membership row is kept; this is the opposite of today's `ON DELETE CASCADE` on `collection_songs.kid`).
- Overview decision 4 (playlist content rows carry all the metadata we need, so `songs` must be able to hold a row for a song whose bytes are not on disk).
- Existing `songs` DDL and `CatalogEntry` shape in `src/db/schema.ts` / `src/db/queries.ts` (feat 01 of `../collections-and-sqlite-refactor/`).

## Scope

### Add

- `src/db/schema.ts`:
  - `media_file` and `downloaded_at` become nullable (SQLite: the column type is unchanged; the `NOT NULL` constraint is what must go).
  - Doc comment on the `songs` table: a row means "known song", not "downloaded song"; `downloaded` is derived from `media_file IS NOT NULL`.
- `src/db/index.ts`:
  - Guarded `PRAGMA table_info(songs)` rebuild: SQLite cannot drop `NOT NULL` in place, so when the live schema still has `media_file`/`downloaded_at` as `NOT NULL`, rebuild the table (create new, copy, drop, rename).
  - Wrap the rebuild in `PRAGMA foreign_keys = OFF` / `PRAGMA foreign_keys = ON` so the `DROP TABLE` does not cascade `collection_songs` away.
- `src/db/queries.ts`:
  - `CatalogEntry.file` / `CatalogEntry.downloadedAt` become nullable; `CatalogEntry` gains `downloaded: boolean` (derived, `media_file !== null`).
  - `getDownloadedSongs(): CatalogEntry[]` — only rows with `media_file IS NOT NULL`.
  - `isDownloaded(kid)` / `alreadyDownloadedKids(kids)` — test `media_file IS NOT NULL`, never a stored flag.
  - `upsertSongMetadata(item: ImportedItem)` — insert or update the metadata columns only; never clobbers `media_file` / `downloaded_at`.
  - `clearSongDownload(kid)` — sets `media_file = NULL`, `downloaded_at = NULL`; the row and any `collection_songs` membership survive.
  - `songCollectionCount(kid): number` — how many collections the song is a member of.
- `src/index.ts`:
  - `kara:delete` becomes: delete the media folder, then `clearSongDownload(kid)` when `songCollectionCount(kid) > 0`, else hard `deleteSong(kid)`.
  - `kara:media-stream` returns a clear "not downloaded" error for rows with no `media_file` (instead of a file-not-found on a path that never existed).
  - `kara:catalog-backfill` skips rows with no `media_file`.

### Explicitly not in this feat

- No UI change.
- No new IPC channel.

## Acceptance criteria

- Existing catalog still lists and plays every downloaded song.
- Deleting a song that is in a collection leaves it in the collection with `file === null`.
- Deleting a song in no collection still removes the row.
- `npm run lint` passes.

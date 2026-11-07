# Feat 02 — Imported collections (model, migration, queries, IPC)

## Goal

Replace `remote-own` / `remote-subscribed` with a single `imported` source that is a real local copy. `collections` gains `origin` (`'own' | 'public'`) and `remote_plaid`; `id` becomes a local UUID; `remote_playlist_items` is dropped because `songs` now holds the metadata (feat 01).

## Reference

- Overview "The model" (`imported` = local copy of a kara.moe playlist, read-only, only Sync and Download mutate it) and decision 4 (one paginated `GET /api/playlist/{plaid}` call carries all needed metadata).
- Superseded model: `../collections-and-sqlite-refactor/06-remote-playlists-listing.md` and `08-remote-subscribed-collections.md` (their `remote-own` / `remote-subscribed` rows, `remote_playlist_items` snapshot table, and subscribe/sync channels are what this feat replaces).
- Existing `collections` / `collection_songs` DDL in `src/db/schema.ts` and the `CollectionRow` / `CollectionRowWithCount` shapes in `src/db/queries.ts`.

## Scope

### Add

- `src/db/schema.ts`:
  - `collections.source` now `'local' | 'imported'`; new nullable columns `origin` (`'own' | 'public'`) and `remote_plaid` (the source playlist's `plaid`).
  - `collections.id` is a local UUID for every row (the remote `plaid` is no longer the id).
  - `remote_playlist_items` table dropped.
- `src/db/index.ts` (migration, run on open, guarded by `PRAGMA table_info` checks):
  - Rebuild `collections` with a `coll_map` temp table remapping old ids → new local UUIDs.
  - Remap `collection_songs.collection_id` through `coll_map`.
  - Materialize `remote_playlist_items` into `songs` rows (via `upsertSongMetadata`) plus `collection_songs` membership, including not-downloaded kids; then drop `remote_playlist_items`.
  - Existing `remote-own` rows → `source: 'imported'`, `origin: 'own'`, `remote_plaid` = old id; `remote-subscribed` rows → `origin: 'public'`.
  - Unique index on `remote_plaid`.
- `src/db/queries.ts`:
  - `importCollection(params: {plaid, name, ownerUsername, origin, items: ImportedItem[]}) => CollectionRow` — upsert keyed on `remote_plaid`: a second import of the same plaid syncs, never duplicates.
  - `syncImportedCollection(id: string, items: ImportedItem[]) => void` — replace membership + upsert song metadata from the fresh pull; bumps `lastSyncedAt`.
  - `findCollectionByPlaid(plaid: string) => CollectionRow | undefined`.
  - `CollectionRowWithCount` gains `downloadedCount` (rows with `media_file IS NOT NULL`) alongside `songCount`.
  - `collectionsForSong(kid)` restricted to `local` collections (imported collections are read-only; a song's membership there is managed by Sync, not by the user).
- `src/kara-api.ts`:
  - `RemotePlaylistItem` gains `langs: string[]` and `offVocal: boolean` (from the playlist content rows' `langs[]` / `versions[]`).
- `src/index.ts`:
  - New `kara:collection-import` and `kara:collection-sync-imported` channels.
  - `kara:collection-download` rewritten to use `collection_songs` membership and never re-sync implicitly.
  - New `kara:collection-download-song` (single song inside an imported collection).
  - `kara:collection-sync-remote-own` reduced to a read-only `kara:playlists-mine` (discovery list only; writes nothing).
  - Delete `kara:collection-subscribe`, `kara:collection-sync-subscribed`, `kara:collection-remote-items`.
- `src/preload.ts` + `src/global.d.ts`: mirrored `window.kara.*` methods and types for all of the above.

### Verification

Before relying on decision 4, fetch one real playlist via `GET /api/playlist/{plaid}` and confirm the content rows carry `titles` / `series` / `singers` / `duration` / `langs` / `versions`. Fall back to per-song `/karas/{kid}` only for a field that is genuinely missing.

### Explicitly not in this feat

- No UI change (the old panels still compile against the new channels only after feat 03).
- No two-way sync back to kara.moe.

## Acceptance criteria

- An existing DB with `remote-own` / `remote-subscribed` rows migrates to `imported` rows with the right `origin` and `remote_plaid`, membership preserved including not-downloaded songs, no duplicate rows on a second launch, no song or file lost.
- Importing the same plaid twice syncs instead of duplicating.
- `npm run lint` passes.

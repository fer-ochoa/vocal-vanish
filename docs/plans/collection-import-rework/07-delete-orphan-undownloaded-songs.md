# Feat 07 — Delete orphan undownloaded songs on imported-collection delete
## Goal
Deleting an imported collection must not leave undownloaded, unreferenced songs behind in the catalog.
## Reference
- Overview "The model" section (imported collections are local, read-only copies of kara.moe playlists).
- Feat 01 (metadata catalog: `media_file IS NULL` means not downloaded; `songs` rows are "known" songs).
- Feat 02 (imported collections: `source === 'imported'`, `remote_plaid`, read-only).
- Existing soft-delete rule in `docs/implementation.md` (deleting a song's download keeps the row when it is in a collection).
## Scope
### Add
- `src/db/queries.ts`:
  - `deleteOrphanUndownloadedSongs(kids: string[]): string[]` — for each kid, keeps the row when it is downloaded (`media_file IS NOT NULL`) or still a member of another collection; deletes it otherwise. Runs inside one transaction.
  - `deleteCollection(id: string): string[]` — deletes the collection (membership rows cascade); when the collection is `source === 'imported'`, calls `deleteOrphanUndownloadedSongs` on its former members. Returns the kids whose catalog row was removed.
- `src/index.ts`:
  - `kara:collection-delete` now returns `{ deletedSongs: string[] }` instead of `true`.
- `src/preload.ts`:
  - `collectionDelete(id): Promise<{ deletedSongs: string[] }>` (type change from `Promise<boolean>`).
- `src/views/CollectionsView.vue`:
  - Delete confirm for an imported collection warns that songs that are not downloaded and are in no other collection will be removed from the catalog.
  - Green toast reports how many songs were removed.
### Explicitly not in this feat
- No GC on local-collection delete (local collections are user-curated; their songs are always kept).
- No GC on Sync (songs that vanish upstream keep their catalog row).
- No media-file deletion (undownloaded rows have no media folder).
## Acceptance criteria
- Deleting an imported collection removes exactly the undownloaded songs that are in no other collection.
- Downloaded songs and songs shared with another collection survive.
- Local-collection delete is unchanged.

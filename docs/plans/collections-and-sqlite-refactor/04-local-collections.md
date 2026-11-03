# Feat 04 — Local collections (create, rename, delete, add/remove song)

## Goal

Add purely local, in-app collections (`source: 'local'` rows in `collections`): named ordered lists of songs you already have downloaded, with no kara.moe sync involved. This is the first user-visible "collections" feature and is independent of login (feat 03) — a user who never logs in can still make and use local collections.

Functional state after this feat: everything from feats 01–03 still works; additionally there's a new Collections screen where the user can create/rename/delete local collections and, from the Catalog screen, add/remove a song to/from any local collection. Opening a collection to view/reorder its songs is feat 05 — this feat only needs enough of a collection list UI to create/rename/delete, since "open a collection" needs its own row-list view and is cleanly separable.

## Reference

Design doc §1 (conceptual model — why membership is many-to-many, why there's no synthetic "local" collection containing every download), §3.3/§3.4 (`collections`/`collection_songs` tables, already created by feat 01's DDL), §3.6 (`collectionsForSong`, `replaceCollectionMembership` query patterns), §5 (`kara:collection-create`, `kara:collection-add-song`, `kara:collection-remove-song`, `kara:collection-delete`, `kara:collections-list`).

## Scope

### Add
- `src/db/queries.ts`:
  - `listCollections(): CollectionRow[]` — all collections, any `source`, ordered by `name` (or `createdAt`; pick one, `name` is more usable for a flat list).
  - `createLocalCollection(name: string): CollectionRow` — generates a UUID id, `source: 'local'`, `createdAt`/`updatedAt` = now, no `ownerUsername`/`lastSyncedAt`.
  - `renameCollection(id: string, name: string): void` — bumps `updatedAt`. (Not in the design doc's IPC table explicitly, but needed for a usable "create/rename/delete" set — call this out if you'd rather skip rename for v1 and only have create/delete.)
  - `deleteCollection(id: string): void` — deletes the `collections` row; `ON DELETE CASCADE` handles `collection_songs` rows automatically (schema already has this from feat 01). Never touches `songs` or files, per design doc §1/§5.
  - `getCollectionSongs(collectionId: string): CatalogEntry[]` — joins `collection_songs` → `songs`, ordered by `position`. (Used fully by feat 05, but add it now alongside the mutation helpers so query helpers for this table are added together.)
  - `addSongToCollection(collectionId: string, kid: string): void` — appends at `position = current max + 1`; no-op (or ignore via `INSERT OR IGNORE`) if already a member, since the PK is `(collectionId, kid)`.
  - `removeSongFromCollection(collectionId: string, kid: string): void` — deletes the one membership row; does not touch `songs`.
  - `collectionsForSong(kid: string): {id, name}[]` — exactly the design doc §3.6 helper, used by the Catalog row's "add/remove from collection" control to show current membership.
- `src/index.ts`: new `handle` channels — `kara:collections-list`, `kara:collection-create`, `kara:collection-rename` (if kept), `kara:collection-delete`, `kara:collection-add-song`, `kara:collection-remove-song`, `kara:collection-songs` (for `getCollectionSongs`, pulled forward for feat 05 to consume directly without a new IPC channel later), `kara:collections-for-song`.
- `src/preload.ts` + `src/global.d.ts`: mirrored `window.kara.*` methods for all of the above, typed with a shared `CollectionRow` interface (`{id, name, source, ownerUsername: string|null, createdAt, updatedAt, lastSyncedAt: string|null}`).
- New screen `src/views/CollectionsView.vue`: lists all collections (name, source badge, song count — song count needs a small query addition, e.g. `listCollectionsWithCounts()` doing a `COUNT` join, or compute client-side from `getCollectionSongs` per row if the list is small; prefer the SQL `COUNT` for correctness at scale), with "New collection" (prompts for a name, same `window.prompt`-free pattern as the rest of the app — look at how `CatalogView.vue` uses `window.confirm` for delete and follow the same lightweight-dialog convention, or a simple inline text input + button if preferred), rename (inline edit), and delete (confirm, same `window.confirm` pattern as `CatalogView.vue`'s delete).
- `src/router.ts`: new route `{ path: '/collections', name: 'collections', component: CollectionsView }`.
- `src/App.vue`: new sidebar nav item "Collections" between "Catalog" and "Config", linking to `/collections`.
- `src/views/CatalogView.vue`: add a per-row "Add to collection…" control (e.g. a small dropdown/menu listing all collections with checkboxes reflecting current membership, calling `addSongToCollection`/`removeSongFromCollection`). This is the only change to the existing Catalog row UI in this feat.

### Explicitly not in this feat
- No "open a collection and see/reorder its songs in a dedicated view" (feat 05) — `CollectionsView.vue` here is a flat list of collections, not a drill-down.
- No remote collections (`remote-own`/`remote-subscribed`) — those are `source` values this feat's code must tolerate existing (e.g. don't assume every row is `local`), but nothing in this feat creates them (feats 06/08 do).
- No bulk download (feat 07).

### Flagged for confirmation
- **Sidebar placement** — proposed: new top-level "Collections" item, per the table above. Confirm or redirect.
- **Rename support** — proposed to include it since a usable collections feature needs it; drop it from this feat if you'd rather keep v1 to create/delete only (it's one query helper + one IPC handler + one UI affordance, so it's low cost to keep).

## Acceptance criteria

- Everything from feats 01–03 still works unchanged.
- Creating a local collection shows it in the Collections screen immediately; renaming updates its name in place; deleting removes it from the list and does not touch any song's file or its `songs` row (verify via Catalog screen: the song is still there, undeleted, just no longer flagged as a member of the deleted collection).
- From the Catalog screen, adding a song to two different local collections and then checking `collectionsForSong` reflects both; removing from one leaves it in the other.
- A song can exist in zero collections (the default for every song downloaded today) with no special-casing anywhere — standalone downloads are never auto-added to any collection.
- `npm run lint` passes; `npm run start` manual walkthrough of create/rename/add/remove/delete.

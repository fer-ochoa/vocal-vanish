# Feat 05 — Collection detail view (browse, reorder, play, remove)

## Goal

Let the user open a single collection (from feat 04's Collections list) and see its songs in order, play any of them, remove a song from the collection, and reorder the songs. This turns feat 04's flat collection list into an actually-usable feature.

Functional state after this feat: everything from feats 01–04 still works; additionally clicking a collection in the Collections screen opens a detail view of that collection's songs.

## Reference

Design doc §3.3 (`collection_songs.position` preserves order), §3.6 (`replaceCollectionMembership` — this feat's reorder action is the natural use of that helper: recompute the full ordered `kid` list client-side after a drag/move and call it, rather than inventing a separate "swap two positions" primitive).

## Scope

### Add
- `src/db/queries.ts`: `reorderCollection(collectionId: string, orderedKids: string[]): void` — thin wrapper over the design doc §3.6 `replaceCollectionMembership` transaction (delete all membership rows for the collection, reinsert in the given order, bump `updatedAt`). Note: `replaceCollectionMembership` as written in the design doc also bumps `lastSyncedAt` — for a `local`-source collection that's semantically wrong (nothing was "synced"); split this into two helpers or make the `lastSyncedAt` bump conditional on `source !== 'local'` so a purely local reorder doesn't fabricate a fake sync timestamp.
- `src/index.ts`: `kara:collection-reorder` handle channel: `{collectionId, orderedKids}` → calls `reorderCollection`.
- `src/preload.ts` + `src/global.d.ts`: mirrored `reorderCollection` method.
- New view `src/views/CollectionDetailView.vue`: given a `collectionId` route param, loads the collection's metadata (name, source, song count) and its songs via `window.kara.collectionSongs(collectionId)` (the channel/query already added in feat 04), renders them as a list similar to `CatalogView.vue`'s rows (title/series/singer/tags/duration, Play button routing to `/player/:kid` exactly like Catalog does) plus:
  - a "Remove from collection" action per row (calls `removeSongFromCollection`, re-fetches or splices locally),
  - drag-to-reorder (or, if drag-and-drop is more than this feat should take on, simple "move up"/"move down" buttons per row — **pick whichever is simpler to implement correctly**; up/down buttons are the safer minimal choice and still satisfy "can reorder" — call out which was chosen when implementing).
- `src/router.ts`: new route `{ path: '/collections/:id', name: 'collection-detail', component: CollectionDetailView, props: true }`.
- `src/views/CollectionsView.vue` (from feat 04): make each collection row clickable, routing to `collection-detail`.

### Explicitly not in this feat
- No remote sync behavior — this view works identically for `local` collections (the only kind that exists through feat 04) and must not assume `source === 'local'` in a way that breaks once feat 06 introduces `remote-own` rows (e.g. don't hide the Remove button only for `local` — removing a song from your own synced favorites via this UI is reasonable and feat 06 should decide whether that also calls `deleteFavorites` remotely or stays purely local-removal; **flagging this for the feat-06 author to resolve explicitly**, this feat just needs to not crash on a non-local `source`).
- No bulk-add from Catalog beyond what feat 04 already built.

## Acceptance criteria

- Opening a local collection shows its songs in the order they were added; Play works per row exactly like Catalog's Play.
- Removing a song from the collection updates the view immediately and does not delete the song from the library (verify in Catalog: song still present).
- Reordering (drag or up/down buttons) persists across navigating away and back, and across app restart.
- `npm run lint` passes; manual walkthrough: create collection → add 3 songs from Catalog → open it → reorder → remove one → confirm Catalog still has all 3 underlying songs.

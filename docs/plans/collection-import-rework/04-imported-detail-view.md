# Feat 04 — Imported collection detail view (per-song + bulk download, Sync)

## Goal

Inside an imported collection the user can download songs individually or all at once, and re-sync from the source.

## Reference

- Overview "The model" (imported collections are read-only: no adding, no removing, no reordering; the only mutations are Sync and Download) and decision 3 (import never downloads; downloading is only offered inside an imported collection, per song or in bulk).
- Existing `src/views/CollectionDetailView.vue` (local branch) and its progress overlay / `onCollectionDownloadProgress` wiring from `../collections-and-sqlite-refactor/` feats 05/07.
- `kara:collection-sync-imported`, `kara:collection-download`, `kara:collection-download-song` channels from feat 02.

## Scope

### Add

- `src/views/CollectionDetailView.vue` — three branches (local unchanged; imported; the old remote branches deleted):
  - Imported rows show position, title, series/singer tags, duration, and either a Play button (downloaded) or a "Not Downloaded" tag plus a Download button.
  - Header gets Sync (calls `collectionSyncImported`, shows "synced Xm ago", stale banner on failure) and "Download all missing (N)" (calls `collectionDownload`, reusing the existing progress overlay and `onCollectionDownloadProgress`).
  - No reorder, no remove, no add on imported rows.

### Explicitly not in this feat

- No sync-on-open.
- No auto-download on import.

## Acceptance criteria

- Importing a playlist downloads nothing.
- Download on one row fetches only that song and flips the row to Play.
- Download all missing fetches exactly the not-downloaded ones and reports downloaded/skipped/failed.
- Sync after editing the playlist upstream reflects the new order and count without duplicating rows or deleting files.
- A playlist deleted upstream marks the collection stale and keeps the last copy.
- `npm run lint` passes.

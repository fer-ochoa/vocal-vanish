# Feat 05 — Catalog shows "Not Downloaded" rows

## Goal

Songs that arrived via an import appear in the Catalog as "Not Downloaded".

## Reference

- Overview decision 2 (deleting a song from a collection keeps the `songs` row with `file === null`; the song renders as "Not Downloaded") and decision 3 (import never downloads).
- `kara:delete` behavior from feat 01 (clears the download and keeps the row when the song is in a collection) and `kara:download` / `kara:collections-for-song` (the latter now returns only `local` collections, per feat 02).
- Existing row rendering, filter and pagination in `src/views/CatalogView.vue`.

## Scope

### Add

- `src/views/CatalogView.vue`:
  - Render every `songs` row.
  - Not-downloaded rows get a `Not Downloaded` tag, no Play and no Lyricless button, a Download button calling `kara:download`, and a delete confirm worded "Remove this song from your library?" that calls the same `kara:delete` (which now clears the download and keeps the row when it is in a collection).
  - The add-to-collection menu lists only `local` collections (the IPC already rejects others).
  - Filter and pagination keep working over the mixed list.

### Explicitly not in this feat

- No change to Search.
- No bulk download from Catalog.

## Acceptance criteria

- After importing a playlist, its songs show in Catalog as Not Downloaded.
- Downloading one flips it to Play without a reload.
- Deleting a downloaded song that is in a collection leaves it listed as Not Downloaded.
- Deleting one that is in no collection removes it.
- `npm run lint` passes.

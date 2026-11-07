# Plan overview — Collection Import rework

> Supersedes the `remote-own` / `remote-subscribed` model of [`../collections-and-sqlite-refactor/`](../collections-and-sqlite-refactor/00-overview.md). That plan's feats 01–05 and 10 stay valid; feats 06–08 are replaced by this one.

## The model

A collection is either:

- **`local`** — created in-app. The user adds and removes songs freely.
- **`imported`** — a **local copy** of a kara.moe playlist (the user's own, or anyone's public one). It stores the source `plaid` plus the metadata of every song in it. It is **read-only**: no adding, no removing, no reordering. The only mutations are **Sync** (re-pull from the source) and **Download** (per song, or all missing).

Importing never downloads anything. Downloading is only offered *inside* an imported collection, per song or in bulk.

## Ground rule

Every feat leaves the app fully working and shippable. No feat is half-done across a commit boundary.

## Ordering

```
01-songs-metadata-catalog        (songs table holds metadata for undownloaded songs)
   └─ 02-imported-collections    (collections model + migration + queries + IPC)
         ├─ 03-import-ui         (Import buttons, Imported tab)
         │     └─ 04-imported-detail-view  (per-song + bulk download, Sync)
         ├─ 05-catalog-not-downloaded      (Catalog shows metadata-only rows)
         └─ 07-delete-orphan-undownloaded-songs  (orphan GC on imported-collection delete)
06-update-architecture-docs      (docs only, last)
```

01 and 02 are invisible refactors and must land first. 03 needs 02. 04 needs 03. 05 needs 01 (and is independent of 03/04, but reads better after them).

## Decisions taken

1. **Fourth tab "Imported"**, placed immediately to the right of "Local". Tab order: `Local · Imported · Public · Mine`.
2. **Deleting a song from a collection does not remove it from the collection.** The song stays in the collection and shows as **"Not Downloaded"** — the bytes and the `songs` row are deleted, the membership row is kept. (This is the opposite of today's `ON DELETE CASCADE` on `collection_songs.kid`; see feat 01.)
3. **Import never downloads.** After importing, the user picks songs individually or downloads all missing in bulk.
4. **Playlist content rows carry all the metadata we need** (`titles`, `series[]`, `singers[]`, `duration`, `langs[]`, `versions[]`), so importing a playlist needs exactly one paginated `GET /api/playlist/{plaid}` call and no per-song `/karas/{kid}` calls. Feat 02 verifies this against one real playlist before relying on it.

## Feat index

| # | File | Adds | User-visible change |
|---|---|---|---|
| 01 | `01-songs-metadata-catalog.md` | nullable `media_file`/`downloaded_at`, derived `downloaded`, membership survives song deletion | None (internal) |
| 02 | `02-imported-collections.md` | `source: 'imported'`, `remote_plaid`, `origin`, migration of existing remote rows, import/sync queries + IPC | None (internal) |
| 03 | `03-import-ui.md` | Import buttons on Public/Mine, new Imported tab | New: can import a playlist |
| 04 | `04-imported-detail-view.md` | Imported collection detail: per-song download, download-all, Sync | New: can download from an import |
| 05 | `05-catalog-not-downloaded.md` | Catalog renders metadata-only rows with a "Not Downloaded" tag | New: imported songs appear in Catalog |
| 06 | `06-update-architecture-docs.md` | `docs/implementation.md` + design doc §1/§3 | Docs only |
| 07 | `07-delete-orphan-undownloaded-songs.md` | orphan GC on imported-collection delete | New: deleting an import cleans up its undownloaded songs |

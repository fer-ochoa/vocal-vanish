# Feat 03 — Import UI (Import buttons, Imported tab)

## Goal

The user can import a playlist from the Public or Mine tab and see it in a new Imported tab.

## Reference

- Overview decision 1 (fourth tab "Imported", placed immediately to the right of "Local"; tab order `Local · Imported · Public · Mine`) and decision 3 (import never downloads).
- Existing tabbed layout in `src/views/CollectionsView.vue` and the `PublicCollectionsPanel.vue` / `MineCollectionsPanel.vue` panels from `../collections-and-sqlite-refactor/` feats 06/08/10.
- `kara:collection-import` and `kara:playlists-mine` channels from feat 02.

## Scope

### Add

- `src/views/CollectionsView.vue`:
  - Four tabs in this order — Local · Imported · Public · Mine — driven by `?tab=local|imported|public|mine`.
  - Imported tab enabled always; Mine still disabled while logged out.
- New `src/components/collections/ImportedCollectionsPanel.vue`:
  - Per row: name, origin badge ("yours" / "public"), "X of Y downloaded", "synced 3m ago", stale tag, delete.
- `src/components/collections/PublicCollectionsPanel.vue`:
  - "Subscribe" → "Import"; "Subscribed" section → "Imported from public playlists"; already-imported rows show "Imported ✓" and are disabled.
- `src/components/collections/MineCollectionsPanel.vue`:
  - "Sync now" → "Refresh list" (discovery only, writes nothing) plus a per-row Import button and the same already-imported state.

### Explicitly not in this feat

- No detail-view changes (feat 04).
- No download action here.

## Acceptance criteria

- Importing from either tab creates one row in the Imported tab and nothing is downloaded.
- Importing the same playlist twice does not duplicate.
- The Imported tab survives a reload via `?tab=`.
- `npm run lint` passes.

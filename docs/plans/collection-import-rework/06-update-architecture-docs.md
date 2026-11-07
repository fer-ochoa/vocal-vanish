# Feat 06 — Update architecture docs

## Goal

Docs match the shipped model.

## Reference

- Overview "The model" and "Decisions taken" (the four decisions the docs must reflect).
- `docs/implementation.md` (current storage model, `collections.source` values, IPC channel list) and `docs/collections-and-sqlite-refactor.md` §1/§3 (the `remote-own` / `remote-subscribed` model being superseded).

## Scope

### Add

- `docs/implementation.md`:
  - Storage model: `songs` as a metadata catalog (a row means "known", `downloaded` derived from `media_file IS NOT NULL`).
  - `collections.source` is `local` / `imported`; `remote_plaid` / `origin` on imported rows.
  - The import → sync → download lifecycle (import never downloads; per-song and bulk download only inside an imported collection; deleting a song's download keeps the row and the membership).
  - The IPC channel list (new `kara:collection-import`, `kara:collection-sync-imported`, `kara:collection-download-song`, `kara:playlists-mine`; removed `kara:collection-subscribe`, `kara:collection-sync-subscribed`, `kara:collection-remote-items`).
- `docs/collections-and-sqlite-refactor.md` §1 and §3:
  - Mark the `remote-own` / `remote-subscribed` model as superseded, point at this plan.

### Explicitly not in this feat

- No code changes.

## Acceptance criteria

- A reader can tell from `docs/implementation.md` alone how a song gets into the library and how an imported collection differs from a local one.

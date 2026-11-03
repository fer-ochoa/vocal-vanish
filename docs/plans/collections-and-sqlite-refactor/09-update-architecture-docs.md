# Feat 09 — Update `docs/implementation.md` for the new storage model

## Goal

Bring the project's main architecture doc back in sync with reality once the storage refactor (feats 01–02 at minimum; ideally whichever of 03–08 actually shipped) has landed. This is a docs-only feat with no code change, done last so it describes what was actually built rather than what was planned.

## Reference

Design doc §7 (file/module change table) names this explicitly: "Update storage section (§5 'Catalog storage', §10 file layout) to describe `library.db` + `media/<kid>/` instead of flat files + `catalog.json`, once implemented."

## Scope

- Read `docs/implementation.md` in full and locate every section describing the current flat-file + `catalog.json` storage model (the design doc points at "§5 Catalog storage" and "§10 file layout" using that doc's own section numbering at the time it was written — confirm the actual current section numbers/headings in `docs/implementation.md` since they may have shifted, and update whichever sections actually describe storage).
- Rewrite those sections to describe, as of whatever has actually been implemented by the time this feat runs:
  - `library.db` (SQLite via better-sqlite3 + Drizzle) as the index, replacing `catalog.json`.
  - `media/<kid>/` per-song folders and `tmp/<kid>.part` staging, replacing the flat file layout.
  - If feats 03–08 (or some subset) also shipped by this point: document the `account`/`collections`/`collection_songs` tables and the collections feature at whatever level of detail `implementation.md`'s existing style uses for other features (match its tone — it reads as a fairly detailed technical reference, not a marketing doc).
- Add a short "superseded" note or just remove outright any passage that still describes `catalog.json`/flat-file behavior as current, so the doc doesn't contradict itself.
- Cross-check `docs/collections-and-sqlite-refactor.md` itself: once implemented, update its header status line (currently "Status: design/planning document, not yet implemented") to reflect reality, or add a short "implemented as of <date>, see docs/implementation.md" pointer — whichever this project's convention prefers (check how `docs/lyricless-plan.md` vs `docs/lyricless-implementation.md` relate to each other, since that's an existing precedent for a "plan doc" + "implementation doc" pair in this repo, and mirror that pattern for consistency).

## Explicitly not in this feat

- No code changes.
- No new features — purely reconciling documentation with whatever was actually implemented in feats 01–08 (or the subset that shipped, if 08 stayed blocked/dropped).

## Acceptance criteria

- `docs/implementation.md` accurately describes the storage model and any shipped collections/account features, with no remaining references to `catalog.json` as the current mechanism.
- `docs/collections-and-sqlite-refactor.md`'s status line reflects implementation state.
- A fresh reader of `docs/implementation.md` alone (without this plan folder) can understand the current on-disk layout and DB schema correctly.

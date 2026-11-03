# Feat 07 — Bulk download a collection (dedup against the global library)

## Goal

Add a "Download all missing songs" action to a collection's detail view (feat 05), usable on the `remote-own` favorites collection introduced in feat 06 (and, for completeness, on any collection with non-downloaded members — though `local` collections can currently only contain already-downloaded songs per feat 04's "add from Catalog" flow, so in practice this matters for remote collections). Downloads proceed only for songs not already present in the local library, per the core requirement in the design doc: a song already downloaded standalone — or via a different collection — must never be re-downloaded.

Functional state after this feat: everything from feats 01–06 still works; the collection detail view gains a bulk-download affordance with its own progress reporting, reusing the existing single-song download machinery under the hood.

## Reference

Design doc §1 ("if the user already has a song... and adds another collection in bulk, it must be detected as already downloaded"), §3.6 (`missingKidsForBulkDownload`), §5 (`kara:collection-download` channel: fetch remote list → diff → download only missing → update `collection_songs` via `replaceCollectionMembership` → progress events per song in flight).

## Scope

### Add
- `src/db/queries.ts`: expose `missingKidsForBulkDownload(remoteKids: string[]): string[]` exactly as design doc §3.6 (thin wrapper over `alreadyDownloadedKids`, already added in feat 01).
- `src/index.ts`: `kara:collection-download` handle channel: `{collectionId}` →
  1. Load the collection's current/target kid list (for `remote-own`, this is whatever `kara:collection-sync-favorites` from feat 06 last populated — re-sync first so the download reflects the latest favorites, or operate on the already-synced local `collection_songs` rows; **prefer re-syncing first** so a stale local copy doesn't silently skip new favorites).
  2. Compute `missingKidsForBulkDownload`.
  3. For each missing kid, run the same fetch-metadata-then-stream-to-`tmp/`-then-move-into-`media/<kid>/` logic `kara:download` already uses (factor the body of `kara:download` into a shared internal function, e.g. `downloadSong(kid, onProgress): Promise<CatalogEntry>`, called by both the single-song handler and this bulk one — do not duplicate the download logic).
  4. After each song's bytes land, `upsertSong` as usual (same as single download).
  5. Report progress per song in flight via the existing `kara:download-progress` event channel (same `{kid, received, total}` shape), so the renderer's progress UI pattern from `SearchView.vue`/`CatalogView.vue` can be reused with minimal changes — no new progress-event shape needed.
  6. A small concurrency cap (reuse the `CONCURRENCY = 5`-style constant pattern already used by `kara:catalog-backfill`, though for byte-heavy downloads a lower cap like 2–3 concurrent songs is more considerate of the user's bandwidth and the kara.moe server — pick a conservative default and note it as tunable).
  7. On completion, call `replaceCollectionMembership`-equivalent to ensure `collection_songs` matches the full target list (not just the newly-downloaded ones — songs already owned before this bulk action still belong in the collection's membership).
  8. Returns a summary: `{downloaded: number, skipped: number, failed: {kid, error}[]}` so partial failures (one song errors mid-batch) don't abort the whole operation or silently vanish — surfaced in the UI as which songs failed and why, the rest having still succeeded.
- `src/preload.ts` + `src/global.d.ts`: mirrored `collectionDownload(collectionId)` method, plus reuse of the existing `onDownloadProgress` listener (already generic over `kid`, no change needed there).
- `src/views/CollectionDetailView.vue`: "Download all missing" button (disabled while a bulk download is in flight, hidden/disabled when there's nothing missing), a progress overlay listing per-song status (reuse the single-song progress overlay pattern from `SearchView.vue`/`CatalogView.vue`, extended to show a list rather than one bar — e.g. one bar per in-flight song, capped at the concurrency limit, with a running count of completed/total), and a results summary once done (X downloaded, Y failed with reasons, shown via the existing toast pattern or a small results list in the overlay before it closes).

### Explicitly not in this feat
- No change to single-song download's IPC contract or behavior — `kara:download` keeps working exactly as today (it's refactored internally to share `downloadSong`, but its signature/return/progress-event shape are unchanged).
- No handling of `remote-subscribed` collections (feat 08) — this feat's UI entry point can be built generically enough to work for any collection id regardless of `source`, but there's nothing to wire it to for `remote-subscribed` until feat 08 exists.

## Acceptance criteria

- A favorites collection (feat 06) with some songs already downloaded standalone and some not: "Download all missing" downloads only the not-yet-owned ones, skips the rest, and the skip count in the summary matches reality.
- Mid-batch failure (e.g. temporarily disconnect network after the first song): the operation reports the successes and the failure(s) distinctly rather than losing all progress; songs that did finish are present in the Catalog afterward.
- Running "Download all missing" a second time immediately after a full success reports 0 downloaded / all skipped, with no duplicate files or rows.
- Concurrent single-song download (from Search) while a bulk collection download is in flight does not corrupt either operation's progress reporting or produce duplicate/partial files (shared `downloadSong` + per-kid `tmp/<kid>.part` naming from feat 02 already prevents path collisions; verify this holds under the bulk path too).
- `npm run lint` passes; manual walkthrough with a real favorites collection of at least 3–4 songs, mixing already-owned and new ones.

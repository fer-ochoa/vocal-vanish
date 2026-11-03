# Feat 06 — List the logged-in user's kara.moe favorites as a collection

## Goal

When logged in (feat 03), fetch the user's own kara.moe favorites and expose them as a `remote-own` collection the user can browse (metadata + song list) using the same detail view built in feat 05. **No download behavior yet** — that's feat 07. This feat is "see your kara.moe favorites inside vocal-vanish," read-only against the local library (songs are flagged downloaded/not, nothing is fetched).

Functional state after this feat: everything from feats 01–05 still works unchanged when logged out (no `remote-own` collection exists without a session). When logged in, the Collections screen additionally shows a "My Favorites" entry that opens to a read-only(-ish) list of the user's kara.moe favorites, each row flagged as already-downloaded or not against the local `songs` table.

## Reference

Design doc §4 (`getFavoritesMicro`, `getFavorites` endpoints), §1 (dedup must be against the **global** `songs` table, never per-collection — this is exactly where that matters: a favorite the user already downloaded standalone must show as downloaded here too), §5 (`kara:collection-browse` channel, described as returning paginated rows flagged downloaded against the global table).

## Scope

### Add
- A small kara.moe API client addition (alongside the existing `httpGetJson`/song-search code in `src/index.ts`, or factor into `src/kara-api.ts` if that split feels cleaner given the file's growing size — **recommended**, since this file has grown a lot across feats 01–05): a call to the user's favorites, authenticated with the stored `account.token`. Confirm against the live API (same verification spirit as feat 03's login spike) whether to use `getFavoritesMicro` (cheap, just `{kid}` list — good for a first "what do I have" check) followed by `getFavorites`/per-kid lookups for display metadata, or whether `getFavorites` alone (paginated, full song objects) is simpler to use directly. The design doc favors `getFavoritesMicro` for cheap existence checks but doesn't mandate the exact call sequence for building a browsable list — use whichever minimizes round-trips for a typical favorites-list size.
- On successful login (feat 03) or on demand (e.g. opening the Collections screen while logged in), upsert a single `collections` row with a fixed, well-known id convention (e.g. `remote-own:<username>` or simply detect-and-upsert-one-row-where-source=remote-own-and-ownerUsername=username) so there's exactly one `remote-own` row representing "my favorites," not a new one per sync.
- `src/db/queries.ts`: `upsertRemoteOwnCollection(username, name): CollectionRow`, and reuse `replaceCollectionMembership`/`reorderCollection`'s underlying transaction (from feats 04/05) to write the fetched favorites' kid list into `collection_songs` for that row, setting `lastSyncedAt`.
- `src/index.ts`: new `kara:collection-sync-favorites` (or fold the sync into `kara:collections-list` triggering automatically when logged in — **pick the simpler one**; an explicit sync action with a visible "synced Xm ago" / "Sync now" affordance is more honest about network cost and matches the design doc's `lastSyncedAt` rationale, so prefer an explicit action) that: fetches favorites, upserts the `remote-own` collection row + membership, flags each row against the global `songs` table (reusing `alreadyDownloadedKids` from feat 01), and returns the updated song list for display.
- `src/preload.ts` + `src/global.d.ts`: mirrored method.
- `src/views/CollectionsView.vue`: when logged in (check via `accountStatus()`), show the "My Favorites" entry (with its `lastSyncedAt`) alongside local collections, with a "Sync now" affordance; route it to the same `CollectionDetailView.vue` from feat 05, which already needs to not assume `source === 'local'`.
- `src/views/CollectionDetailView.vue`: for a `remote-own` collection, each row's Play button is **disabled/hidden** if `!downloaded` (nothing to play yet — download comes in feat 07), rows show a "not downloaded" indicator instead of a dead Play button.

### Explicitly not in this feat
- No download action from this view (feat 07) — rows that aren't downloaded just show their flag, no button to act on it yet. This keeps this feat strictly about read/display and defers the download-orchestration complexity to its own feat.
- No `remote-subscribed` (other users') collections (feat 08).
- No two-way sync (removing a favorite in-app does not call `deleteFavorites` on kara.moe in this feat — if feat 05's "Remove from collection" action is invoked on a `remote-own` row, the simplest correct behavior for *this* feat is to disable/hide that action for `remote-own` rows entirely, deferring any remote-mutation decision to a later feat; call this out explicitly when implementing so it isn't silently half-wired).

## Acceptance criteria

- Logged out: Collections screen shows exactly what feat 04/05 showed (no "My Favorites" entry, no crash).
- Logged in with favorites on kara.moe: "My Favorites" appears, "Sync now" fetches and populates it, each row correctly flags downloaded/not-downloaded against the local library (verified by: download one of the favorited songs from Search first, then sync — that song shows downloaded; others don't).
- Logging out and back in does not duplicate the `remote-own` collection row (upsert, not insert).
- `npm run lint` passes; manual verification against the real kara.moe API (requires a test account with at least one favorite).

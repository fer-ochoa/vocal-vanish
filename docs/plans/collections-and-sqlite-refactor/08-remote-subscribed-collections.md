# Feat 08 — Browse & subscribe to another user's public collection

## ⚠️ Status: BLOCKED — do not implement until the open question below is resolved

## Goal (as currently scoped by the source design doc)

Let a logged-in user discover and browse **another kara.moe user's public collection/favorites**, and "subscribe" to it locally (creating a `source: 'remote-subscribed'` row in `collections`, `ownerUsername` set to that user), reusing the same browse/detail/bulk-download machinery built in feats 05–07.

## Why this is blocked

The source design doc (`docs/collections-and-sqlite-refactor.md`, §4) lists the kara.moe/Karaoke Mugen endpoints it found relevant to "collections," and every one of them (`getFavoritesMicro`, `getFavorites`, `addFavorites`, `deleteFavorites`, `exportFavorites`, `importFavorites`) operates on **the currently-authenticated user's own** favorites. The doc's own feature list (§0) says the app should support fetching "other users' public collections," but §4 never names — and I could not independently confirm — a kara.moe API endpoint for:
- discovering/searching other users by username, or
- fetching a given username's public favorites/playlist (as opposed to your own).

It's plausible such an endpoint exists under the Karaoke Mugen Server API (the doc points at `https://api.karaokes.moe/app/` as the general reference) but confirming it requires either checking that live API reference directly or testing against a real server with two accounts — neither of which this planning pass did, per the instruction not to implement.

## What's needed to unblock

One of:
1. **A confirmed endpoint.** Check `https://api.karaokes.moe/app/` (or the live kara.moe REST passthrough) for something like "get user's public favorites" or "search karas by uploader/favorited-by." If found, this feat gets rewritten with the real contract and unblocked.
2. **A scope decision from you.** If no such endpoint exists (kara.moe's favorites may simply be private-to-the-owner with no public browsing API), this feat should be **dropped from scope**. The app would then ship with local collections (04/05) + your-own-favorites (06/07) as a complete, coherent feature set, and "browse someone else's public collection" would need a different mechanism entirely if it's still wanted (e.g. the user manually pastes/imports a shared favorites export via kara.moe's `exportFavorites`/`importFavorites` JSON round-trip, which *is* documented — that would be a different, smaller feat: "import a favorites JSON export as a local collection," not a live remote-browse feature).

## Tentative shape (for when/if unblocked)

If a real "browse user X's public favorites" endpoint is confirmed, this feat's shape mirrors feat 06 closely:
- Add a "Browse user" entry point (username input) that fetches that user's public song list.
- On "Subscribe," upsert a `collections` row (`source: 'remote-subscribed'`, `ownerUsername: <that username>`), write membership via the same `replaceCollectionMembership` pattern, and the existing `CollectionDetailView.vue` (feat 05) + bulk-download (feat 07) work unchanged since they're already written to not assume `source`.
- Needs a decision on re-sync semantics: does "Subscribe" snapshot once, or does the UI offer a recurring "Sync now" like feat 06's own-favorites view? Recommend mirroring feat 06 (explicit "Sync now," `lastSyncedAt` shown) for consistency.
- Needs a decision on multiplicity: can a user subscribe to many other users' collections? (Almost certainly yes — `collections` already supports arbitrarily many `remote-subscribed` rows with no schema change needed.)

## Explicitly not in this feat (even once unblocked)

- No two-way interaction with another user's collection (no editing, no "suggest a song" — strictly read + locally mirror + bulk-download).

## Acceptance criteria

N/A until unblocked and rewritten with a confirmed API contract.

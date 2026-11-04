# Feat 08 — Browse & subscribe to another user's public kara.moe playlists

## Goal

Let a logged-in user discover another kara.moe user, browse that user's **public playlists**, and "subscribe" to one locally (creating a `source: 'remote-subscribed'` row in `collections`, `ownerUsername` set to that user's username, `id` = the remote `plaid`), reusing the same browse/detail/bulk-download machinery built in feats 05–07.

This feat is the other-users' counterpart of feat 06 (which covers **your own** playlists as `remote-own`). Same remote object type (`plaid`, ordered `content[]`), different ownership: that's the only real difference, and it's why the `collections.source` enum already has both values.

## Status: READY — API contract confirmed

An earlier draft of this file was marked BLOCKED on the assumption that no endpoint existed for another user's public playlists. That assumption was wrong. Verified against the live REST API on 2026-11-04 (`https://kara.moe/api`, same routes as the Swagger at `https://api.karaokes.moe/server/`) — note the published swagger for this route is out of date, `byUsername`/`order` are the params that actually work:

- `GET /api/playlist` — **public, no auth**. Returns a flat **array** of playlist objects: `{plaid, name, description, slug, karacount, duration, created_at, modified_at, flag_visible, flag_visible_online, username, nickname, avatar_file, favorited, contributors[]}`. Relevant query params:
  - `filter=<text>` — matches name and description.
  - `order=<az|recent|karacount|duration|username>` — alphabetically by name, more recent first, number of songs, playlist duration, owner username; invalid values are a `400 INVALID_DATA`, so validate client-side. (Check the returned direction once: `?order=recent` was observed sorting by `created_at` ascending, and `karacount`/`duration` ascending — reverse client-side if your label says "most first".)
  - `byUsername=<username>` — that user's playlists only (case-insensitive; unknown user → empty array). **This is what makes browsing another user cheap** instead of pulling the ~1477-row/~600 KB array and filtering locally.
  - `includeUserAsContributor=true` — also include playlists the user merely contributes to (presence-only flag: `=false` does *not* exclude them, only omitting it does).
  - Per the upstream app: browsing **all** users passes only `filter` and `order`; a **specific** user's list passes `filter`, `order`, `byUsername`, and `includeUserAsContributor=true` if you want shared playlists too.
  - The whole filtered array comes back in one response, so page client-side if a broad filter returns a lot.
- `GET /api/playlist/{plaid}?from=&size=&filter=` — **public, no auth**. Returns `{infos: {count, from, to}, i18n, avatars, content: [...]}` where each content row is a full song object plus `pos` (1-based), `plcid`, `plaid`, `added_at`, `flag_favorites`. `from`/`size` **do** work here (page size 100 verified), so this is the route that needs a paging loop.
- `GET /api/users?filter=&size=&from=` — public user list (`{infos, content: UserPublic[]}`); `GET /api/users/{user}` — public profile (or `UserNonPublic` if the user hid it). Useful for the "who am I browsing" header; `UserPublic` carries `flag_displayfavorites`, `favorites_count`.
- Auth: `Authorization: Bearer <JWT>`. Anonymous on a protected route → `401`; any malformed token → `403 "Malformed token"`, **including on public routes** — so do not attach the token to the playlist calls at all.

Remaining (product, not technical) decision: how the user picks whom to browse — a plain username text field, a `GET /users?filter=`-backed picker, or a deep-link from a search result's uploader. Pick one when implementing; the username field is the smallest and is the recommended default.

## Reference

Design doc §1 (dedup against the **global** `songs` table, never per-collection), §3.3 (`collections.id` = kara.moe's own playlist id), §4 (remote playlist endpoints), §5 (`kara:collection-browse`).

## Scope

### Add
- `src/kara-api.ts` (or wherever feat 06 put the client): `getUserPlaylists(username, { filter?, order?, includeContributions = true })` — one `GET /api/playlist?filter=&order=<order>&byUsername=<username>&includeUserAsContributor=true` **without** an `Authorization` header (public route; a stale token turns it into `403`). Because the filter happens server-side this is a small response (a 65-playlist user is ~39 KB), so no client-side username filtering is needed. Keep the additional `flag_visible_online === true` guard as a cheap defensive filter. Cache the last result in memory for the session and re-fetch on an explicit "Refresh" / on a filter or order change; debounce the filter box (the response is small but not free). `getPlaylistContents(plaid)` — same paginated fetcher feat 06 uses; **share it**, don't duplicate.
- Browsing **all** users' playlists (a discovery view, if you add one) is the same call with only `filter` and `order` — never `byUsername`. That returns the full ~1477-row/~600 KB array, so it needs paging client-side and should not be triggered on every keystroke.
- With `includeUserAsContributor=true`, some returned playlists are owned by *someone else* (`playlist.username` ≠ the browsed username). Decide and document: either show them labelled "shared by <owner>" and store them as `remote-subscribed` with `ownerUsername = playlist.username`, or leave the flag off for subscriptions (opt in per playlist). Do not silently present them as the browsed user's own work.
- `src/db/queries.ts`:
  - `upsertSubscribedCollection(plaid, name, ownerUsername): CollectionRow` — `source: 'remote-subscribed'`, `id` = `plaid`, `ownerUsername` = the other user. Upsert keyed on `id` (re-subscribing / re-syncing must not duplicate), bumping `updatedAt`/`lastSyncedAt`.
  - `replaceCollectionMembership(...)` — the shared ordered delete-and-reinsert transaction (same one feat 05/06 use).
  - Same FK caveat as feat 06: `collection_songs.kid` references `songs.kid`, so a subscribed collection can only hold **already-downloaded** songs. Persist the full ordered remote list the same way feat 06 does (the snapshot table/JSON column) so the detail view can show not-yet-downloaded entries; feat 07's bulk download fills in membership rows as songs land. Also set `collections.remote_item_count` from the remote `karacount` (feat 06 introduced that column) so the list can show "X of Y downloaded".
- `src/index.ts`: `kara:collection-browse-user` (`{username, filter?, order?, includeContributions?}` → that user's playlists via the server-side `byUsername` filter, no DB writes — this is pure discovery) and `kara:collection-subscribe` (`{plaid}` → upsert the `remote-subscribed` row + fetch contents + persist the ordered snapshot + return the collection row). No auth required for either call; if the token isn't valid, still allow browsing (public data) and don't fail the whole screen.
- `src/preload.ts` + `src/global.d.ts`: mirrored methods.
- UI:
  - `src/views/CollectionsView.vue`: a "Browse a kara.moe user" entry (username input + optional `filter` box and `order` selector → results list showing each public playlist's name, `karacount`, `duration`, owner nickname, plus a "Subscribe" button per row). Subscribed rows appear in the normal collection list with the `remote-subscribed` badge (already handled by `sourceBadgeClass`). Label results whose owner differs from the searched username ("shared by <owner>") so contributed playlists aren't mistaken for the user's own.
  - `CollectionDetailView.vue`: works unchanged in shape — ordered rows, downloaded → Play, not downloaded → badge only, "Remove from collection" and reordering **disabled/hidden** for `remote-subscribed` (you can't edit someone else's playlist; unsubscribing is `collectionDelete`, which already only removes local rows).
- Re-sync semantics: mirror feat 06 — explicit "Sync now" per subscribed collection, showing `lastSyncedAt`, **not** periodic polling. If the remote playlist was deleted or made private since subscribing, keep the local row and mark it stale (the songs are still the user's downloads and remain downloadable/playable); surface "no longer public" in the detail view rather than silently deleting.

### Explicitly not in this feat
- No editing another user's playlist in any way (no rename/reorder/add/remove, no `PUT`/`POST`/`DELETE` on `/playlist/{plaid}`).
- **Not** another user's *favorites*: `GET /favorites` is auth-only and returns the caller's own favorites, so "someone else's favorites" is not achievable through it. Public *playlists* are the supported equivalent, and that's what this feat covers. (If the user wants a specific favorites list browsable, the mechanism is that they publish it as a playlist on kara.moe.)
- No browsing of playlists that are `flag_visible_online === false` (defensive client-side filter — the list currently contains none, but the field exists and means "don't show online").
- No bulk download from the subscribe step itself; feat 07's action handles any collection, including this one.

## Acceptance criteria

- Browsing a username with ≥2 public playlists lists exactly those (`name`, `karacount` matching the API), and never lists another user's playlists — verified by the request carrying `byUsername=<that user>` plus the server-side filtering actually taking effect (response size proportionate to that user, not the ~1477-row global list).
- Passing the `order` selector changes the returned order to match the API enum (`az` / `recent` / `karacount` / `duration` / `username`); passing `filter` narrows by name and description; both are reflected in the request, not applied only in the renderer.
- With `includeUserAsContributor=true`, a contributed playlist is shown with its real owner (`playlist.username`) and stored as `remote-subscribed` under that owner; with the flag omitted it does not appear. (Verify with a user who both owns and contributes to playlists.)
- Playlists with `flag_visible_online === false` are excluded from browse results.
- Subscribing creates exactly one `remote-subscribed` row (`id` = `plaid`, `ownerUsername` = that user); subscribing twice, or syncing again, does not duplicate it.
- Opening a subscribed collection shows every song in remote `pos` order (spot-check a paginated one against `GET /playlist/{plaid}`), with downloaded/not flags matching the local library.
- Edit affordances (remove/reorder) are absent or disabled on subscribed rows; deleting the local row removes only the local collection and its snapshot, never the downloaded songs (verify in Catalog).
- A playlist deleted/made private on kara.moe after subscribing is handled per the keep-and-mark-stale policy: local row and downloads survive, UI says it's no longer public.
- Browsing works while logged out (public data) and does not surface auth errors; a malformed/expired token never breaks the browse screen (`403` on public routes must be avoided by not sending the header).
- `npm run lint` passes; manual verification with a real second kara.moe account whose playlist you can see.

# Plan overview — Collections, Accounts & SQLite Library

> Source design doc: [`../../collections-and-sqlite-refactor.md`](../../collections-and-sqlite-refactor.md)
> This folder breaks that design into small, sequentially-implementable feats. **Do not implement** — this is the planning artifact; implementation is done by another AI/session, one feat file at a time, in order.

## Ground rule

**Every feat below must leave the app in a fully working, shippable state** — existing screens (Search, Catalog, Config, Player) keep working exactly as today after each feat lands, even if the feat's own new capability is only exercised in a later feat. No feat may be "half done" across a commit boundary.

## Ordering & dependencies

```
01-sqlite-songs-table              (replaces catalog.json; no user-visible change)
   └─ 02-per-song-folder-layout     (media/<kid>/ + tmp/; no user-visible change)
         ├─ 03-account-login                       (adds Account UI; app still fully usable logged-out)
         └─ 04-local-collections                   (adds Collections UI; independent of login)
               └─ 05-collection-browsing-view       (view + manage songs inside one local collection)
                     ├─ 06-remote-favorites-listing  (needs 03 + 04/05; lists kara.moe favorites as a collection)
                     │     └─ 07-bulk-collection-download   (needs 06; download-all-missing for any collection)
                     └─ 08-remote-subscribed-collections (needs 03; BLOCKED — see open questions below)
09-update-architecture-docs         (docs-only; do last, once 01–08 — or whichever shipped — are implemented)
```

01 and 02 are pure refactors (storage mechanics only) and must land first since every later feat depends on the `songs` table and the per-song folder layout existing. 03 (login) and 04 (local collections) are independent of each other and can be built in either order once 01+02 are done. 05 depends on 04. 06/07 depend on login + collections existing. 08 depends only on login but is **blocked** pending a decision — see below.

## Open questions needing your input before the blocked/ambiguous feats proceed

1. **08-remote-subscribed-collections is blocked.** The source doc's §4 only documents kara.moe endpoints for the *logged-in user's own* favorites (`getFavorites`, `getFavoritesMicro`, `addFavorites`, `deleteFavorites`, `exportFavorites`, `importFavorites`). It never names an endpoint for **discovering or fetching another user's public collection** (e.g. search users by name, list a given username's public playlists). I could not find this documented anywhere the design doc points to. Before `08` can be implemented we need either:
   - a confirmed kara.moe/Karaoke Mugen Server API endpoint for this, or
   - a decision to drop this capability from scope (the app would then only support *your own* favorites + purely local collections, which is still a complete, coherent feature set).
   I've written `08` as a best-effort placeholder structured around the pattern of the other collection feats, flagged clearly as not-ready-to-implement until this is resolved.

2. **Login UI placement.** The doc specifies the IPC contract (`kara:login`/`logout`/`account-status`) but not where the login form lives in the UI. `03-account-login.md` proposes adding a new "Account" section to the existing Config screen (simplest, no new route/nav item). Flagged in that file — tell me if you'd rather have a dedicated sidebar entry/screen instead.

3. **Collections entry point in navigation.** The doc doesn't specify UI placement for collections either. `04-local-collections.md` proposes a new top-level "Collections" sidebar item + route (`/collections`), consistent with the existing Search/Catalog/Config pattern. Flagged in that file for confirmation.

4. **Transport verification for login (§4 of the source doc).** The source doc explicitly says kara.moe's primary protocol is Socket.IO with a REST passthrough (`/api/command`) whose exact shape should be "re-verified against the live API when implementing." `03-account-login.md` carries this as a required first step of that feat (a short spike/verification before writing the handler), not a blocker for planning.

If you'd rather I resolve 2 and 3 myself with the proposed defaults and only pause on 1, say so and I'll drop the "flagged" language from those two files.

## Feat index

| # | File | Adds | User-visible change |
|---|---|---|---|
| 01 | `01-sqlite-songs-table.md` | `library.db`, `songs` table, Drizzle wiring, one-off `catalog.json` import | None (internal storage swap) |
| 02 | `02-per-song-folder-layout.md` | `media/<kid>/` folders, `tmp/` staging dir | None (internal storage layout) |
| 03 | `03-account-login.md` | `account` table, login/logout IPC + Config UI | New: can log in/out of kara.moe |
| 04 | `04-local-collections.md` | `collections` + `collection_songs` tables, create/delete/rename, add/remove song, Collections screen | New: can group songs into local playlists |
| 05 | `05-collection-browsing-view.md` | Open a collection, see its songs in order, play/remove from there | New: collection detail view |
| 06 | `06-remote-favorites-listing.md` | Lists the logged-in user's kara.moe favorites as a `remote-own` collection (metadata + browse, no download yet) | New: see your kara.moe favorites in-app |
| 07 | `07-bulk-collection-download.md` | "Download all missing songs in this collection" for any collection | New: bulk download with dedup |
| 08 | `08-remote-subscribed-collections.md` | Browse/subscribe to another user's public collection | **Blocked**, see open question 1 |
| 09 | `09-update-architecture-docs.md` | Updates `docs/implementation.md` to describe the new storage model | Docs only |

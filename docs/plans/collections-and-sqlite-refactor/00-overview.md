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
                     ├─ 06-remote-playlists-listing  (needs 03 + 04/05; lists YOUR OWN kara.moe playlists as collections)
                     │     └─ 07-bulk-collection-download   (needs 06; download-all-missing for any collection)
                     └─ 08-remote-subscribed-collections (needs 03 + 04/05; other users' public playlists)
09-update-architecture-docs         (docs-only; do last, once 01–08 — or whichever shipped — are implemented)
```

01 and 02 are pure refactors (storage mechanics only) and must land first since every later feat depends on the `songs` table and the per-song folder layout existing. 03 (login) and 04 (local collections) are independent of each other and can be built in either order once 01+02 are done. 05 depends on 04. 06/07 depend on login + collections existing. 08 depends on login + collections (04/05 for the browse view) and is no longer blocked — the public playlist endpoints were verified against the live API while revising 06 (see open question 1).

## Open questions needing your input

1. **08-remote-subscribed-collections — RESOLVED, no longer blocked.** The earlier version of this plan claimed no endpoint existed for another user's public playlists; that was wrong. Verified against the live REST API on 2026-11-04 — and the published Swagger for this route is out of date, so use these params, not the ones it documents:
   - `GET /api/playlist` is **public** (no auth) and returns a flat array of playlist objects (`plaid`, `name`, `description`, `slug`, `karacount`, `duration`, `flag_visible`, `flag_visible_online`, `username`, `nickname`, `favorited`, `contributors[]`). The params that matter:
     - `filter=<text>` — matches playlist name and description.
     - `order=<az|recent|karacount|duration|username>` — alphabetically by name, more recent first, number of songs, playlist duration, owner username. An invalid value is a `400 INVALID_DATA`, so validate client-side.
     - `byUsername=<username>` — only that user's playlists (case-insensitive; unknown user → empty array). This is what makes both feat 06 and feat 08 cheap: no need to pull the ~1477-row/~600 KB array and filter locally.
     - `includeUserAsContributor=true` — also return playlists that user merely contributes to. Presence-only: `=false` does **not** exclude them, only omitting the param does.
   - Usage pattern in the upstream app: **all users** → only `filter` + `order`; **logged-in user's own** → `filter` + `order` + `byUsername=<me>` + `includeUserAsContributor=true`.
   - `GET /api/playlist/{plaid}?from=&size=&filter=` is **public** and returns the ordered contents (`content[].pos`, `plcid`, full song objects, paginated via `infos.count/from/to`) — `from`/`size` **do** work here, so this is the route that needs a paging loop.
   - Remaining product decision for 08 (not a blocker): whether the "browse a user" UI is a plain username field or a `GET /users?filter=` picker, and whether contributed playlists are included/labelled. `08` has been rewritten around the confirmed contract.

2. **Login UI placement.** The doc specifies the IPC contract (`kara:login`/`logout`/`account-status`) but not where the login form lives in the UI. `03-account-login.md` proposes adding a new "Account" section to the existing Config screen (simplest, no new route/nav item). Flagged in that file — tell me if you'd rather have a dedicated sidebar entry/screen instead.

3. **Collections entry point in navigation.** The doc doesn't specify UI placement for collections either. `04-local-collections.md` proposes a new top-level "Collections" sidebar item + route (`/collections`), consistent with the existing Search/Catalog/Config pattern. Flagged in that file for confirmation.

4. **Transport verification for login (§4 of the source doc).** The source doc explicitly says kara.moe's primary protocol is Socket.IO with a REST passthrough (`/api/command`) whose exact shape should be "re-verified against the live API when implementing." `03-account-login.md` carries this as a required first step of that feat (a short spike/verification before writing the handler), not a blocker for planning. (Settled in practice by feat 03's implementation: auth is a plain `POST /api/auth/login` returning a JWT used as `Authorization: Bearer …`; **note any invalid `Authorization` header turns even public routes into `403`**, so the token must only be attached where needed.)

If you'd rather I resolve 2 and 3 myself with the proposed defaults and only pause on the product choice inside 1, say so and I'll drop the "flagged" language from those two files.

## Feat index

| # | File | Adds | User-visible change |
|---|---|---|---|
| 01 | `01-sqlite-songs-table.md` | `library.db`, `songs` table, Drizzle wiring, one-off `catalog.json` import | None (internal storage swap) |
| 02 | `02-per-song-folder-layout.md` | `media/<kid>/` folders, `tmp/` staging dir | None (internal storage layout) |
| 03 | `03-account-login.md` | `account` table, login/logout IPC + Config UI | New: can log in/out of kara.moe |
| 04 | `04-local-collections.md` | `collections` + `collection_songs` tables, create/delete/rename, add/remove song, Collections screen | New: can group songs into local playlists |
| 05 | `05-collection-browsing-view.md` | Open a collection, see its songs in order, play/remove from there | New: collection detail view |
| 06 | `06-remote-playlists-listing.md` | Lists the logged-in user's **own kara.moe playlists** as one `remote-own` collection each (metadata + browse, no download yet) | New: see your kara.moe playlists in-app |
| 07 | `07-bulk-collection-download.md` | "Download all missing songs in this collection" for any collection | New: bulk download with dedup |
| 08 | `08-remote-subscribed-collections.md` | Browse/subscribe to another user's public playlists | New: browse someone else's playlists |
| 09 | `09-update-architecture-docs.md` | Updates `docs/implementation.md` to describe the new storage model | Docs only |

# Feat 03 — kara.moe account login

## Goal

Add the ability to log in/out of a kara.moe account, persisted in the singleton `account` table. This is purely additive: the app must keep working fully logged-out (search, standalone download, everything from feats 01/02) with no row in `account`.

Functional state after this feat: same as before, plus a new "Account" section where the user can log in/out and see their current login status. Nothing else in the app changes behavior based on login state yet (that starts in feat 06).

## Reference

Design doc §4 (kara.moe account login) and §3.3/§3.4 (the `account` table, already created by feat 01's DDL). §5's table also lists the exact new IPC channel names to use (`kara:login`, `kara:logout`, `kara:account-status`).

## ⚠️ Required first step: verify the transport before writing the handler

The source design doc is explicit that this needs verification against the live API: kara.moe/Karaoke Mugen Server's primary protocol is **Socket.IO**, with a REST passthrough at `/api/command` as "a convenience wrapper." The doc gives the *shape* of the login call (`{ username, password }` → `{ token, username, role, onlineToken? }`) but not a confirmed, tested request against the real server. Before implementing the `kara:login` handler:

1. Confirm the exact request format for `/api/command` (or whatever the current REST passthrough path is) against `https://kara.moe` — method, body shape, how the command name ("login") and its payload are combined, and the exact response shape (confirm `role` enum values and whether `onlineToken` is actually present for this instance).
2. If the REST passthrough turns out to be unavailable or unreliable, the fallback is a Socket.IO client call from the main process (adds `socket.io-client` as a dependency) — same `{username, password}` → `{token, username, role, onlineToken?}` contract, different transport.
3. Record whichever transport is confirmed working as a one-line comment at the top of the new login code, so the choice isn't silently relied upon without a trace.

This spike is part of this feat's implementation, not a separate planning step — but it's called out because it's the one piece of this breakdown that depends on an external system behaving as the design doc assumes.

## Scope

### Add
- `src/db/queries.ts`: `getAccount(): AccountRow | undefined`, `setAccount(row): void` (upsert the singleton id=1 row), `clearAccount(): void`.
- `src/index.ts`: three new IPC handlers per design doc §5:
  - `kara:login` (`handle`): `{username, password}` → performs the verified login request, upserts `account`, returns `{username, role}`. On failure (bad credentials, network error), throws with a user-readable message (same error-surfacing convention as `kara:download` etc. — the renderer already has a toast pattern for this).
  - `kara:logout` (`handle`): clears the `account` row, returns nothing meaningful (or `true`).
  - `kara:account-status` (`handle`): returns `{loggedIn: boolean, username?: string, role?: string}`. Never returns the token to the renderer.
- `src/preload.ts`: add `login`, `logout`, `accountStatus` methods to the `kara` API object, mirroring the three channels (same `invoke` wrapper pattern as every existing method).
- `src/global.d.ts`: no change needed directly (it just re-exports `KaraApi`), but confirm the new preload methods show up on `window.kara`'s type.

### UI (flagged — confirm placement)

**Proposed default:** add an "Account" card to the existing Config screen (`src/views/ConfigView.vue`), above or below the existing "Separation model" card, with:
- Logged-out state: username + password fields, "Log in" button, error message area.
- Logged-in state: "Logged in as `<username>` (`<role>`)" text + "Log out" button.
- Calls `window.kara.accountStatus()` on mount to decide which state to render, same pattern `ConfigView.vue` already uses for `window.kara.settings()`.

This avoids a new route/nav item since login by itself has no content to browse — it's just a state toggle that later feats (06) read. **If you'd rather have a dedicated "Account" entry in the sidebar/a separate screen instead of folding it into Config, say so**; the rest of this feat (IPC/DB) is identical either way, only the `.vue` location changes.

### Explicitly not in this feat
- No playlists/collections fetching (feat 06) — login only establishes and stores the session.
- No UI anywhere else reacting to login state (e.g. Search/Catalog screens don't change).

## Acceptance criteria

- Logged-out app: search, download, catalog, lyricless, delete all work exactly as before (feat 02's acceptance criteria still pass).
- Entering valid kara.moe credentials logs in, persists the session (survives app restart — `kara:account-status` reflects "logged in" after relaunch), and shows the logged-in state in the UI.
- Entering invalid credentials shows an error, does not create an `account` row, and leaves the app in the logged-out state.
- Logging out clears the `account` row and reverts the UI to the logged-out state; app continues to work normally.
- `npm run lint` passes; manual verification of login/logout round-trip against the real kara.moe API.

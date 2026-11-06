# Feat 10 — Split the Collections screen into Local / Public / Mine tabs
## Goal
`src/views/CollectionsView.vue` stacked four unrelated blocks in one column — the remote-own sync toolbar, the new-local-collection input, the 'Browse a kara.moe user' disclosure panel, and one flat list mixing every collection source. With feats 04–08 landed that screen is cramped and it is unclear what belongs to whom. Split it into a big horizontal three-segment tab bar (**Local · Public · Mine**) where only the active tab's components render.
## Reference
Builds on feat 04 (local collections), feat 06 (remote-own playlists), and feat 08 (remote-subscribed collections). The underlying IPC channels and DB schema are untouched — this is a pure view-layer reorganization.
## Scope
### Add
- **Tab bar** in `src/views/CollectionsView.vue`: three equal segments (`flex: 1 1 0`), each showing a label + count badge, with `role="tab"` / `aria-selected`. The active segment uses `--accent`. Styles in `src/styles.css`: `.coll-tabs`, `.coll-tab`, `.coll-tab-count`, plus `.new-collection` and `.input-sm` which the panels depend on.
- **Selection lives in the route query**: `#/collections?tab=local|public|mine`, default `local`. Written with `router.replace({ name: 'collections', query: { ...route.query, tab } })`, read on mount, and kept in sync via `watch(() => route.query.tab, ...)`. No new route.
- **Source → tab mapping**: `local` → **Local**, `remote-subscribed` → **Public**, `remote-own` → **Mine**.
- **Three extracted components** in `src/components/collections/` with the exact prop/emit contract:
  - `LocalCollectionsPanel` — props `collections` (filtered to local) + `loaded`; emits `refresh` / `open(id)` / `remove(id,name)` / `error(message)`.
  - `MineCollectionsPanel` — props `collections` (remote-own) + `loggedIn` + `username`; emits `refresh` / `open` / `error`.
  - `PublicCollectionsPanel` — props `collections` (**the full unfiltered list** — its `isSubscribed()` checks every collection id) + `username`; emits `refresh` / `open` / `remove` / `error`.
  - State moved verbatim from the view. `window.confirm` + `collectionDelete` stay in the parent's `remove()` because Local and Public both use it. `openDetail()` passes `query: { from: activeTab }`.
- **Mine is disabled while logged out** (tooltip points at the Config screen) and `activeTab` falls back to `local` when the account resolves logged-out (`enforceTab()` called from `loadAccount()` plus `watch(loggedIn, enforceTab)`). Public stays usable logged out — browsing is public data (feat 08).
- **`CollectionDetailView.vue`**: a `← Collections` back link in the header returning to `{ name: 'collections', query: { tab: route.query.from ?? 'local' } }`; the existing id-watcher `router.replace` now spreads `query: { ...route.query }` so the hint survives.
- The redundant per-row `source` tag was dropped from Local rows (the tab already says 'local').
- **Bug fixed in passing**: `renameInput` lived inside a `v-for`, so Vue handed back an array and `renameInput.value?.focus()` silently did nothing; the panel now types it `HTMLInputElement | HTMLInputElement[] | null` and focuses the first entry.
- **Decisions**:
  - Subscribed collections live under **Public** (a subscription originates from public browsing; Mine stays strictly your own kara.moe playlists — moving them to Local later is a two-line change).
  - **Local** is the default tab (works logged out, no network).
  - Panels are **not** `<KeepAlive>`d, so browse results reset on a tab switch — acceptable because `getUserPlaylists` already caches per `username|filter|order` in `src/kara-api.ts`.
### Explicitly not in this feat
- No changes to `src/index.ts`, `src/preload.ts`, `src/global.d.ts`, `src/kara-api.ts`, `src/db/*`.
- No new IPC channel and no new route.
- No change to `CollectionDetailView`'s bulk-download / stale / sync behaviour.
- No generic shared row component (Local and Mine rows differ in actions — ~35 duplicated template lines are cheaper than a `v-if` ladder).
## Acceptance criteria
- Tab bar is full-width with three equal thirds, labels Local / Public / Mine, correct active state and `aria-selected`; counts shown only when > 0.
- Only the active tab's components are rendered (no sync toolbar or browse panel on Local, no create input on Public/Mine).
- Every collection appears in exactly one tab and none disappear.
- `?tab=` survives an app reload and the open-collection → back round-trip.
- Mine is disabled while logged out while Public browsing still works logged out.
- Subscribing adds the row to Public's Subscribed section without a manual reload; unsubscribing removes it.
- Create / rename / delete on Local and Sync now / order / filter on Mine behave exactly as before.
- `npm run lint` passes with no unused imports left in `CollectionsView.vue`.

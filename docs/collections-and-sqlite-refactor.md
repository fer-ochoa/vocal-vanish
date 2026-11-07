# Collections, Accounts & SQLite Library — Refactor Plan

> **Status:** design/planning document, not yet implemented.
> **Audience:** written for another AI (or developer) to pick up and implement directly. It assumes familiarity with the current codebase as described in [`implementation.md`](./implementation.md) but repeats enough context to be self-contained.
> **Scope:** this document covers (1) adding kara.moe account login, (2) adding "collections" — modeled on kara.moe **playlists** (the user's own, other users' public ones), not the favorites list — on top of today's single-song downloads, (3) replacing the flat `catalog.json` + flat-file storage with a per-song folder tree, and (4) replacing the JSON index with a local SQLite database managed through an ORM. Database **migrations are explicitly out of scope** — see §6.

---

## 0. Why this refactor

Today (`src/index.ts`):
- Every downloaded song is a row in `catalog.json` (`Record<kid, CatalogEntry>`), keyed by KID.
- Video files sit flat inside `kara-catalog/` as `<kid>.<size>.<hash>.mp4`, plus a sibling `<kid>.lyricless.mp4` when a lyricless variant exists.
- There is no concept of "collection" or "account" — every download is a one-off, user-initiated, single-song action.

We're adding:
- **Login** to kara.moe (Karaoke Mugen's auth), so the app can fetch **the user's own collections** and **other users' public collections**.
- **Bulk download of a collection**, which must **dedupe against everything already downloaded** (whether that song was downloaded standalone or came from a different collection).
- **Thumbnails** per song (future, but the storage layout should already accommodate it).

None of this should break the existing single-song search → download → catalog → play → lyricless flow; it should fit *underneath* it.

---

## 1. Conceptual model: songs vs. collections

> **SUPERSEDED.** The `remote-own` / `remote-subscribed` model described in this section is **superseded** by [`docs/plans/collection-import-rework/`](./plans/collection-import-rework/00-overview.md). In the shipped model: `collections.source` is `'local' | 'imported'` (not `remote-own`/`remote-subscribed`); an **imported** collection is a local, read-only copy of a kara.moe playlist keyed by `remote_plaid`; `songs` is a **metadata catalog** (one row per song the app knows about, with nullable media columns) rather than a download-only list; and the separate `remote_playlist_items` snapshot table was **dropped** — the ordered snapshot now lives in `collection_songs` plus the `songs` rows. The historical content below is retained for reference.

**Do not model "no collection" as a fake "local" collection, and do not let collections own files.** Keep two independent concerns joined by the one stable key kara.moe already gives us, the song's `kid`:

1. **The song library** — one row per downloaded song, keyed by `kid`. This is pure download/file bookkeeping: do we have the bytes, where, what variants. Exactly what `catalog.json` is today, just moved into SQLite.
2. **Collections** — named, ordered lists of `kid` references. A collection can be:
   - `local` — created entirely in this app, never synced to kara.moe (a "my own mix" list).
   - `remote-own` — one of the user's own playlists on kara.moe (`GET /playlist`, filtered to their username; fetched after login / on explicit sync).
   - `remote-subscribed` — another user's **public** playlist the user chose to browse/download from.
3. **Membership** is **many-to-many**: a song can be in zero, one, or many collections, and standalone single-song downloads simply have **zero** collection memberships. That's a first-class, unremarkable state — not a special case.

### Why not a fake "local" collection holding every standalone download?

- It conflates **download state** (do I have the bytes) with **organization** (what curated list is this part of). Every "is this downloaded" check would need to special-case that one magic collection instead of just checking the library table.
- Remote collections are *re-syncable* objects with real identity (id, owner, name, last-synced). A synthetic "local" bucket has none of that and permanently complicates the code path that handles real collections.
- The required behavior — *"if the user already has a song (via single download or in a collection) and adds another collection in bulk, it must be detected as already downloaded"* — falls out for free when dedup is done purely against the song library by `kid`. It becomes an annoying special case the moment "downloaded" is derived from collection membership instead.

### Why this shape, not something bespoke

This is the same shape used by every mainstream library/playlist system, and — more importantly — by **the software that runs kara.moe itself** (Karaoke Mugen App/Server): a global `kara` (song) entity keyed by `kid`, and favorites/playlists that are just arrays of `{kid}` scoped to a user (`GET /playlist/{plaid}` returns ordered `{kid}` contents; `POST /favorites/{kid}` / `DELETE /favorites/{kid}` are per-song, fully decoupled from where/whether the media is stored). Mirroring that is aligning with the upstream system, not reinventing a concept:

- Spotify / Apple Music / YouTube Music: one global track table + playlists that are ordered join rows against it ("Liked Songs" is itself just a playlist internally).
- Plex / Jellyfin: media library separate from playlists/collections (ordered item-id lists); an item needs no playlist membership to exist.
- Subsonic / Navidrome (closest cousin — also a self-hosted JSON/REST media app): `song` table, `playlist` table, `playlist_tracks` join table.

---

## 2. Local folder tree

Replace the flat "all files + `catalog.json` side by side" layout with **one directory per song**, plus a single SQLite file as the only index. This scales cleanly to the known future addition of thumbnails (and anything else per-song later: lyrics file, waveform cache, etc.) without inventing a new top-level concept each time.

```
~/.config/vocal-vanish/kara-catalog/        (Linux; see README for macOS/Windows paths — unchanged)
├─ library.db                   # SQLite — the ONLY index; replaces catalog.json entirely
├─ library.db-wal                # SQLite WAL files (managed by SQLite itself, journal_mode=WAL)
├─ library.db-shm
├─ media/
│  ├─ <kid>/
│  │  ├─ <hardsubbed_mediafile>  # original video, kara.moe's own filename, e.g. "034....34602607.30f5cd2....mp4"
│  │  ├─ lyricless.mp4            # generated vocal-free variant, if created
│  │  └─ thumbnail.<ext>          # future: downloaded thumbnail/cover (ext depends on what kara.moe serves, e.g. webp/jpg)
│  └─ <kid>/...                   # one such folder per downloaded song
└─ tmp/
   └─ <kid>.part                  # in-flight downloads; atomically renamed into media/<kid>/ on completion
```

Rationale:

- **Keyed by `kid`, not by collection.** Collections are metadata + membership rows (see §3); if files lived under collection folders, a song in 3 collections would need 3 copies (or symlink games). Keying storage by `kid` matches the DB primary key 1:1. Deleting a song is `rm -rf media/<kid>/` plus one DB delete, full stop, regardless of how many collections reference it.
- **Keep kara.moe's own filename for the main video** (don't rename it to `original.mp4`). That filename embeds a content hash/size; if kara.moe ever re-encodes a song, the filename kara.moe serves will change too, which gives a cheap future "this file was updated upstream, re-download" signal. The per-`kid` folder already disambiguates it, so the long filename causes no collisions.
- **Fixed, short names for app-generated/derived assets** (`lyricless.mp4`, `thumbnail.<ext>`) since those are ours to name — no need to carry a hash in the filename for files we create ourselves.
- **No hash-sharding** (`media/03/48/<kid>/…`). That pattern exists for stores with millions of blobs (e.g. git objects); a karaoke library is thousands of items at most — a flat `media/<kid>/` stays trivially browsable in a file manager or terminal.
- **`tmp/` is separate from `media/`** so an interrupted download can never leave a half-written file sitting next to finished, valid assets. Startup cleanup is just "delete everything under `tmp/`".
- **`library.db*` files live at the top level**, as siblings of `media/`/`tmp/`, not inside either — it's the index, not a media asset.

### Filename plan

| Asset | Path | Naming rule |
|---|---|---|
| Original video | `media/<kid>/<hardsubbed_mediafile>` | Exactly the filename kara.moe gives in `song.hardsubbed_mediafile` (already contains a hash/size). |
| Lyricless variant | `media/<kid>/lyricless.mp4` | Fixed name — only ever one lyricless variant per song. |
| Thumbnail (future) | `media/<kid>/thumbnail.<ext>` | Fixed base name; extension taken from whatever kara.moe serves (sniff `Content-Type` or the source URL's extension at download time). |
| In-flight download | `tmp/<kid>.part` | Same convention as today; moved with `fs.renameSync` into `media/<kid>/<finalName>` once complete, after `fs.mkdirSync(media/<kid>, {recursive:true})`. |

---

## 3. SQLite schema

> **SUPERSEDED.** The schema described in this section (with `remote-own` / `remote-subscribed` in the `collections.source` CHECK, and the `remote_playlist_items` snapshot table) is **superseded** by [`docs/plans/collection-import-rework/`](./plans/collection-import-rework/00-overview.md). In the shipped schema: `collections.source` is `'local' | 'imported'`; `remote_plaid` and `origin` columns were added to `collections`; `songs.media_file` and `songs.downloaded_at` are nullable (metadata catalog); and `remote_playlist_items` was **dropped** — the ordered snapshot now lives in `collection_songs` plus the `songs` rows. The historical content below is retained for reference.

### 3.1 Driver: `better-sqlite3`

- **Synchronous API**, matching the existing code style (`fs.readFileSync`/`writeFileSync`, no promise wrapping for local I/O that's fast and single-writer).
- It's a native module, but `forge.config.ts` already includes `@electron-forge/plugin-auto-unpack-natives`, which exists precisely to make native `.node` bindings work when packaged into an asar — no new packaging risk is introduced.
- It's the de-facto standard for local SQLite inside Electron apps (far more mature tooling/ecosystem than Node's still-experimental built-in `node:sqlite`).
- All DB access stays in the **main process only**, exactly like today's `fs`/`https` calls — the renderer still never touches Node/fs/DB directly, only `window.kara` IPC methods (see §5).

### 3.2 ORM: Drizzle ORM (over better-sqlite3), no `drizzle-kit` / no migrations

Per the explicit instruction to not worry about migrations, table creation happens via a **one-time, idempotent `CREATE TABLE IF NOT EXISTS` script run at app startup**, not a migration runner. Rationale for Drizzle specifically:

- **Prisma** — avoid. Ships its own native query-engine binary that needs special handling to locate/bundle correctly inside an asar-packaged Electron app; unnecessary complexity for a local single-file SQLite DB.
- **TypeORM / Sequelize** — heavier (decorators + `reflect-metadata` for TypeORM; large runtime for Sequelize); their main value (schema migrations, active-record lifecycle) is exactly what's being skipped here.
- **Kysely** — a legitimate lighter alternative (pure type-safe SQL builder, no ORM relational layer) if even Drizzle feels like too much; mentioned here as a fallback option, not the primary recommendation.
- **Drizzle** — schema defined in plain TypeScript (which *is* the single source of truth — no separate `.sql` migration files to keep in sync), no decorators/`reflect-metadata`, synchronous end-to-end (matches `better-sqlite3`), and its relational query API (`db.query.songs.findMany({ with: { collections: true } })`) removes the need to hand-write every join for the songs↔collections many-to-many relationship.

Install:
```bash
npm install better-sqlite3 drizzle-orm
npm install -D @types/better-sqlite3
```
(`drizzle-kit` is intentionally **not** installed — it's only needed for migration generation, which is out of scope here.)

### 3.3 Tables

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * One row per downloaded song. This is the entire "do I have this song, and
 * where" bookkeeping table — equivalent to today's catalog.json, but as SQL
 * rows instead of a hand-maintained JSON object. The primary key is kara.moe's
 * own `kid` (UUID), which is also the name of the song's folder under media/.
 */
export const songs = sqliteTable("songs", {
  kid: text("kid").primaryKey(),               // kara.moe song UUID; also the media/<kid>/ folder name
  title: text("title").notNull(),
  series: text("series").notNull().default(""),
  singer: text("singer").notNull().default(""),
  duration: integer("duration"),                // seconds; nullable (kara.moe can omit it)
  mediaFile: text("media_file").notNull(),       // filename of the original video inside media/<kid>/
  mediaSize: integer("media_size"),              // bytes
  lyriclessFile: text("lyricless_file"),          // filename inside media/<kid>/, or null if not generated
  thumbnailFile: text("thumbnail_file"),          // filename inside media/<kid>/, or null if not downloaded (future)
  langs: text("langs", { mode: "json" }).$type<string[]>(),   // e.g. ["JPN"]; stored as a JSON text column
  offVocal: integer("off_vocal", { mode: "boolean" }).notNull().default(false),
  downloadedAt: text("downloaded_at").notNull(), // ISO 8601 string, same convention as today
});

/**
 * One row per collection the app knows about: the user's own (synced from
 * kara.moe after login), other users' public collections the user has
 * browsed/subscribed to, and purely local ones created in-app. A collection
 * never owns files directly — it only references songs via collection_songs.
 */
export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),                    // kara.moe's own collection/playlist id, OR a locally-generated uuid for app-only collections
  name: text("name").notNull(),
  source: text("source", { enum: ["local", "remote-own", "remote-subscribed"] }).notNull(),
  ownerUsername: text("owner_username"),           // kara.moe username that owns this collection, if remote; null for local
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),         // bumped whenever metadata or membership changes locally
  lastSyncedAt: text("last_synced_at"),            // ISO date of last successful remote sync; null for purely local collections
  remoteItemCount: integer("remote_item_count"),   // for remote playlists: the remote's own karacount (membership rows only exist for downloaded songs, so this is the only way to show "X of Y")
});

/**
 * Many-to-many join table: which songs belong to which collections, and in
 * what order. Deleting a collection cascades here (removes membership rows
 * only — never touches `songs` or the files on disk). Deleting a song
 * cascades here too (removes it from any collection it was part of).
 */
export const collectionSongs = sqliteTable("collection_songs", {
  collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  kid: text("kid").notNull().references(() => songs.kid, { onDelete: "cascade" }),
  position: integer("position").notNull(),          // preserves the collection's song order
}, (t) => ({
  pk: primaryKey({ columns: [t.collectionId, t.kid] }),
}));

/**
 * Singleton row (id is always 1) holding the current kara.moe login session,
 * if any. Absence of a row (or role = null) means "not logged in" — the app
 * must keep working fully in that state (search + standalone download +
 * local collections), per the original requirement that login is additive,
 * not mandatory.
 */
export const account = sqliteTable("account", {
  id: integer("id").primaryKey(),                   // always 1 — enforced in application code, not a CHECK constraint
  username: text("username").notNull(),
  token: text("token").notNull(),                   // JWT, local auth — sent as the `authorization` field per kara.moe's API
  onlineToken: text("online_token"),                // JWT, only present for online/synced accounts
  role: text("role", { enum: ["guest", "user", "admin"] }).notNull(),
  loggedInAt: text("logged_in_at").notNull(),
});
```

### 3.4 Why each table looks the way it does

| Table | Purpose | Notes |
|---|---|---|
| `songs` | Replaces `catalog.json`. One row = one song you have locally (video present, maybe lyricless/thumbnail too). | Column names mirror the current `CatalogEntry` interface almost 1:1 (`file` → `mediaFile`, `size` → `mediaSize`, etc.) so the port is close to mechanical. |
| `collections` | Metadata about a named list of songs — local or remote, owned or subscribed. | `source` distinguishes sync behavior: `local` never calls the network for sync; `remote-*` do. `lastSyncedAt` lets the UI show "synced 2 hours ago" and lets a future "refresh" action know what's stale. |
| `collection_songs` | The actual many-to-many membership, with explicit ordering. | `ON DELETE CASCADE` on both FKs means removing a collection or a song never leaves orphaned membership rows — but note SQLite only enforces this when `PRAGMA foreign_keys = ON` is set per-connection (see §3.5). |
| `account` | Current login session (if any). | Deliberately a single mutable row, not a `users` table — this app only ever represents **one** logged-in kara.moe account at a time (the desktop user), not a multi-account system. |

### 3.5 Wiring it up

```ts
// src/db/index.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as path from "path";
import { app } from "electron";
import * as schema from "./schema";

const DB_PATH = (): string =>
  path.join(app.getPath("userData"), "kara-catalog", "library.db");

function openDb() {
  const sqlite = new Database(DB_PATH());
  sqlite.pragma("journal_mode = WAL");   // better read/write concurrency; also what most Electron+sqlite apps use
  sqlite.pragma("foreign_keys = ON");     // SQLite disables FK enforcement by default — required for the ON DELETE CASCADE above

  // No drizzle-kit / no migrations: idempotent DDL run on every startup.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      kid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      series TEXT NOT NULL DEFAULT '',
      singer TEXT NOT NULL DEFAULT '',
      duration INTEGER,
      media_file TEXT NOT NULL,
      media_size INTEGER,
      lyricless_file TEXT,
      thumbnail_file TEXT,
      langs TEXT,
      off_vocal INTEGER NOT NULL DEFAULT 0,
      downloaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('local','remote-own','remote-subscribed')),
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_synced_at TEXT,
      remote_item_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS collection_songs (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      kid TEXT NOT NULL REFERENCES songs(kid) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (collection_id, kid)
    );

    CREATE INDEX IF NOT EXISTS idx_collection_songs_kid ON collection_songs(kid);

    CREATE TABLE IF NOT EXISTS account (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      token TEXT NOT NULL,
      online_token TEXT,
      role TEXT NOT NULL CHECK (role IN ('guest','user','admin')),
      logged_in_at TEXT NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

export const db = openDb();
```

### 3.6 Core queries the IPC layer will need

```ts
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { songs, collections, collectionSongs } from "./db/schema";

// "Already downloaded?" — the single source of truth for dedup, used by
// search results, single download, AND bulk collection download alike.
function alreadyDownloadedKids(kids: string[]): Set<string> {
  const rows = db.select({ kid: songs.kid }).from(songs)
    .where(inArray(songs.kid, kids)).all();
  return new Set(rows.map((r) => r.kid));
}

// Bulk collection download: diff first, only fetch what's missing.
function missingKidsForBulkDownload(remoteKids: string[]): string[] {
  const have = alreadyDownloadedKids(remoteKids);
  return remoteKids.filter((k) => !have.has(k));
}

// Which collections is a song currently in (for UI badges / "remove from
// collection" actions).
function collectionsForSong(kid: string) {
  return db.select({ id: collections.id, name: collections.name })
    .from(collectionSongs)
    .innerJoin(collections, eq(collections.id, collectionSongs.collectionId))
    .where(eq(collectionSongs.kid, kid))
    .all();
}

// Write a collection's membership atomically (all-or-nothing), e.g. after a
// bulk sync/download completes.
function replaceCollectionMembership(collectionId: string, orderedKids: string[]) {
  db.transaction((tx) => {
    tx.delete(collectionSongs).where(eq(collectionSongs.collectionId, collectionId)).run();
    orderedKids.forEach((kid, position) => {
      tx.insert(collectionSongs).values({ collectionId, kid, position }).run();
    });
    tx.update(collections)
      .set({ updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString() })
      .where(eq(collections.id, collectionId)).run();
  });
}
```

These four functions cover every dedup/membership requirement from the design discussion: standalone downloads, collection bulk downloads, and badge/status queries.

---

## 4. kara.moe account login

kara.moe is the public frontend of **Karaoke Mugen Server**. Its REST surface is documented by the Swagger UI at `https://api.karaokes.moe/server/` and is served by kara.moe at `https://kara.moe/api` (both verified live on 2026-11-04).

- **Login**: `POST /auth/login` — request `{ username, password }`, response `{ token, username, role }`; the token is a JWT to send as `Authorization: Bearer <token>`. `GET /auth/check` validates a token. Any malformed/expired `Authorization` header returns `403` even on public routes, so only attach it where it is needed.
- **Playlists** (the kara.moe concept that maps to a collection — named, ordered, plural):
  - `GET /playlist` — public, no auth. Flat array of playlist objects: `plaid`, `name`, `description`, `slug`, `karacount`, `duration`, `created_at`, `modified_at`, `flag_visible`, `flag_visible_online`, `username`, `nickname`, `avatar_file`, `favorited`, `contributors[]`. The documented Swagger params for this route are stale; the four to build on are `filter=<text>` (name + description), `order=<az|recent|karacount|duration|username>` (invalid → `400 INVALID_DATA`), `byUsername=<username>` (that user only, case-insensitive), and `includeUserAsContributor=true` (also include playlists the user contributes to — presence-only: `=false` does not exclude them, only omitting the param does). The whole filtered array comes back in one response; unfiltered it is ~1477 rows / ~600 KB, so always pass `byUsername` or `filter`.
  - Usage pattern in the upstream app: **playlists across all users** → pass only `filter` + `order`; **the logged-in user's own** → pass `filter` + `order` + `byUsername=<me>` + `includeUserAsContributor=true`. `order` values mean: `az` = alphabetically by name, `recent` = more recent first, `karacount` = number of songs, `duration` = playlist duration, `username` = owner username alphabetically.
  - `GET /playlist/{plaid}?from=&size=&filter=` — public, no auth. `{infos: {count, from, to}, i18n, avatars, content: [...]}`, where each content row is a full song object plus `pos` (1-based order), `plcid`, `plaid`, `added_at`, `flag_favorites`. Paginated via `from`/`size`. Only the playlist *contents* are unbounded in size, so only they need a paging loop.
  - `POST /playlist`, `PUT /playlist/{plaid}`, `DELETE /playlist/{plaid}`, `POST /playlist/{plaid}` (add songs), `POST /playlist/{plaid}/empty`, `POST /playlist/content/delete`, `PUT /playlist/content/edit`, `/playlist/import`, `/playlist/{plaid}/export` — all auth-only mutations. Not used by the plan (no two-way sync).
  - `GET /users`, `GET /users/{user}` — public user list / public profile, for discovering whose playlists to browse.
- **Favorites** (a different concept; deliberately *not* the model for a collection):
  - `GET /favorites` — auth-only, returns the caller's own favorites as a bare `[{kid}]` list: no order, no name, no pagination.
  - `POST /favorites/{kid}` / `DELETE /favorites/{kid}` — add/remove one favorite.
  - These are user-private and are not usable to read another user's favorites, and they are not playlists. A "Favorites" view could be built later as a single synthetic collection, but the collections model is playlists.

**Implementation guidance (not yet built):**
1. Add `kara:login(username, password)` / `kara:logout()` IPC handlers in the main process. On success, upsert the singleton `account` row (§3.3) with the returned `token`/`username`/`role`/`onlineToken`.
2. Add `kara:account-status()` returning `{ loggedIn: boolean, username?, role? }` so the renderer can show "Logged in as X" / a login form, without ever exposing the raw token to the renderer.
3. All subsequent collection-sync calls (own-playlist listing, playlist contents, public playlist browsing) read the token from the `account` table in the main process and attach it server-side — the renderer only ever calls `window.kara.*` methods, same security boundary as today. Public playlist routes need no token at all.
4. The app must continue to work fully logged-out: search, single-song download, and purely `local` collections never require a row in `account`.

This part was implemented in feat 03 and verified against the live API: login is a plain `POST /api/auth/login` with `{username, password}` returning a JWT, sent afterwards as `Authorization: Bearer <token>` (there is no `/api/command` wrapper in use — the Swagger at `https://api.karaokes.moe/server/` documents the REST routes directly, and `https://kara.moe/api` serves them). One gotcha worth remembering: a malformed/expired token makes even **public** routes answer `403`, so the header must only be attached to requests that actually need it.

---

## 5. IPC surface changes (`src/index.ts` + `src/preload.ts`)

Keep the existing channels (`kara:search`, `kara:catalog`, `kara:download`, `kara:media-stream`, `kara:delete`, lyricless/model/settings channels) **working exactly as they do today** — they all become thin wrappers over the new `songs` table instead of `catalog.json`, with no renderer-visible behavior change (`CatalogEntry`'s shape stays the same from the renderer's point of view; only its backing store changes).

New channels to add:

| Channel | Kind | Purpose |
|---|---|---|
| `kara:login` | `handle` | `{username, password}` → logs in, persists to `account`, returns `{username, role}`. |
| `kara:logout` | `handle` | Clears the `account` row. |
| `kara:account-status` | `handle` | Returns `{loggedIn, username?, role?}`. |
| `kara:collections-list` | `handle` | Returns local `collections` rows (own + subscribed + local), for the sidebar/collections screen. |
| `kara:collection-browse` | `handle` | `{collectionId}` or `{remoteId}` → paginated song rows (reuse `songToRow`), each flagged `downloaded` against the **global** `songs` table (never per-collection). |
| `kara:collection-sync-remote-own` | `handle` | `{filter?, order?}` → lists the logged-in user's own kara.moe playlists (`GET /playlist?filter=&order=&byUsername=<me>&includeUserAsContributor=true`), upserts one `source: 'remote-own'` row per playlist (`id` = `plaid`), fetches contents for the opened ones (`GET /playlist/{plaid}`, paginated) and bumps `lastSyncedAt`. No-op when logged out. |
| `kara:collection-browse-user` / `kara:collection-subscribe` | `handle` | `{username, filter?, order?, includeContributions?}` → that user's public playlists via `byUsername` (no DB writes); `{plaid}` → upsert a `source: 'remote-subscribed'` row + contents snapshot. |
| `kara:collection-download` | `handle` | `{remoteId}` → fetches the full remote song list, computes `missingKidsForBulkDownload`, downloads only those, writes/updates the `collections` + `collection_songs` rows via `replaceCollectionMembership`, reports per-song progress the same way `kara:download-progress` does today (one event stream, `{kid, received, total}` per song in flight). |
| `kara:collection-create` | `handle` | `{name}` → creates a `source: 'local'` collection with a generated UUID. |
| `kara:collection-add-song` / `kara:collection-remove-song` | `handle` | Manage membership of local (and own-remote, if the app later supports editing those) collections from the Catalog view. |
| `kara:collection-delete` | `handle` | Deletes a `collections` row (cascades `collection_songs` only — **never** deletes the underlying `songs` rows or files). |

Preload (`src/preload.ts`) mirrors each of these as a `window.kara.*` method, same pattern as today (`invoke` wrapper, typed params/return).

---

## 6. Migration from the current `catalog.json`

Not a "migration system" — a **one-off import function**, since the explicit instruction is to skip migrations entirely:

1. On first startup after this refactor ships, check whether `library.db` already has any rows in `songs`.
2. If `songs` is empty **and** a legacy `catalog.json` exists in `kara-catalog/`, read it, and for each `CatalogEntry`:
   - `fs.mkdirSync(media/<kid>, {recursive: true})`.
   - Move (`fs.renameSync`, same filesystem, so this is instant) the existing `<kid>.<size>.<hash>.mp4` and (if present) `<kid>.lyricless.mp4` from the old flat layout into `media/<kid>/`.
   - Insert one row into `songs` with the equivalent fields.
3. Rename the old `catalog.json` to `catalog.json.bak` (don't delete outright — cheap insurance) once the import finishes without error.
4. This import function is a plain startup check, not a versioned/reversible migration — exactly matching "don't worry about migrations."

---

## 7. Summary of file/module changes

| File | Change |
|---|---|
| `package.json` | Add `better-sqlite3`, `drizzle-orm` deps; `@types/better-sqlite3` dev dep. (No `drizzle-kit`.) |
| `src/db/schema.ts` | **New.** Table definitions from §3.3. |
| `src/db/index.ts` | **New.** `better-sqlite3` connection, PRAGMAs, idempotent `CREATE TABLE IF NOT EXISTS` DDL, Drizzle instance export. |
| `src/db/queries.ts` | **New.** Query helpers (§3.6) used by the IPC layer — dedup, membership read/write, song CRUD. |
| `src/db/legacy-import.ts` | **New.** One-off `catalog.json` → SQLite + folder-tree import (§6), called once at startup before `registerIpc()`. |
| `src/index.ts` | Replace `readIndex()`/`writeIndex()`/flat-file paths with the `songs` table + `media/<kid>/` folder helpers; add the new IPC handlers from §5; add `kara:login`/`logout`/`account-status`. |
| `src/preload.ts` | Add matching `window.kara.*` methods for every new channel. |
| `src/global.d.ts` | Extend the `KaraApi` type with the new methods/return shapes. |
| `docs/implementation.md` | Update storage section (§5 "Catalog storage", §10 file layout) to describe `library.db` + `media/<kid>/` instead of flat files + `catalog.json`, once implemented. |

Everything above is additive to the existing architecture (main-process-only privileged work, IPC bridge via `preload.ts`, no Node in `.vue` files) — no change to the Electron security model, CSP, or renderer structure is required by this refactor.

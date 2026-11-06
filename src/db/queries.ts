import { eq, inArray, notInArray, sql, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./index";
import { songs, collections, collectionSongs, remotePlaylistItems, account } from "./schema";

/**
 * A catalog entry persisted locally for a downloaded song.
 *
 * This is a local re-declaration of the `CatalogEntry` interface defined in
 * `src/index.ts` (and mirrored in `src/preload.ts`). It is re-declared here
 * — rather than imported — to avoid a circular import: `src/index.ts`
 * imports from this file, so importing the type back from `src/index.ts`
 * would create a cycle. The two declarations are kept identical on purpose;
 * the DB column names (`mediaFile`/`mediaSize`/`lyriclessFile`) are mapped
 * to/from the existing field names (`file`/`size`/`lyriclessFile`) inside
 * this file so every call site above and below it is untouched.
 */
export interface CatalogEntry {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null; // seconds
  file: string; // filename of the hardsub video inside the catalog dir
  size: number | null; // bytes
  downloadedAt: string; // ISO date
  lyriclessFile?: string | null; // filename of the lyricless variant, if generated
  /** Language codes of the song, e.g. ["JPN"]. */
  langs?: string[];
  /** True when the song's version is "Off Vocal" (already instrumental). */
  offVocal?: boolean;
}

/** Map a raw `songs` row to the `CatalogEntry` shape the IPC layer expects. */
function rowToEntry(row: typeof songs.$inferSelect): CatalogEntry {
  return {
    kid: row.kid,
    title: row.title,
    series: row.series,
    singer: row.singer,
    duration: row.duration,
    file: row.mediaFile,
    size: row.mediaSize,
    downloadedAt: row.downloadedAt,
    lyriclessFile: row.lyriclessFile,
    langs: row.langs ?? undefined,
    offVocal: row.offVocal,
  };
}

/** All downloaded songs, sorted by `downloadedAt` desc (same ordering
 *  `kara:catalog` returns today). */
export function getAllSongs(): CatalogEntry[] {
  const rows = db
    .select()
    .from(songs)
    .orderBy(songs.downloadedAt)
    .all()
    .reverse();
  return rows.map(rowToEntry);
}

/** A single song by kid, or undefined if not downloaded. */
export function getSong(kid: string): CatalogEntry | undefined {
  const row = db.select().from(songs).where(eq(songs.kid, kid)).get();
  return row ? rowToEntry(row) : undefined;
}

/** True when the given kid is already in the local catalog. */
export function isDownloaded(kid: string): boolean {
  return db
    .select({ kid: songs.kid })
    .from(songs)
    .where(eq(songs.kid, kid))
    .get()
    !== undefined;
}

/** The subset of `kids` that are already downloaded. */
export function alreadyDownloadedKids(kids: string[]): Set<string> {
  if (!kids.length) return new Set();
  const rows = db
    .select({ kid: songs.kid })
    .from(songs)
    .where(inArray(songs.kid, kids))
    .all();
  return new Set(rows.map((r) => r.kid));
}

/** Insert or update a song row (keyed by kid). */
export function upsertSong(entry: CatalogEntry): void {
  db.insert(songs)
    .values({
      kid: entry.kid,
      title: entry.title,
      series: entry.series,
      singer: entry.singer,
      duration: entry.duration,
      mediaFile: entry.file,
      mediaSize: entry.size,
      lyriclessFile: entry.lyriclessFile ?? null,
      langs: entry.langs ?? null,
      offVocal: entry.offVocal ?? false,
      downloadedAt: entry.downloadedAt,
    })
    .onConflictDoUpdate({
      target: songs.kid,
      set: {
        title: entry.title,
        series: entry.series,
        singer: entry.singer,
        duration: entry.duration,
        mediaFile: entry.file,
        mediaSize: entry.size,
        lyriclessFile: entry.lyriclessFile ?? null,
        langs: entry.langs ?? null,
        offVocal: entry.offVocal ?? false,
        downloadedAt: entry.downloadedAt,
      },
    })
    .run();
}

/** Record a generated lyricless file for a song. */
export function updateLyriclessFile(kid: string, fileName: string): void {
  db.update(songs)
    .set({ lyriclessFile: fileName })
    .where(eq(songs.kid, kid))
    .run();
}

/** Remove a song row from the catalog. */
export function deleteSong(kid: string): void {
  db.delete(songs).where(eq(songs.kid, kid)).run();
}

/** Persist backfilled `langs` / `offVocal` for a song. */
export function backfillSongMetadata(
  kid: string,
  langs: string[],
  offVocal: boolean,
): void {
  db.update(songs)
    .set({ langs, offVocal })
    .where(eq(songs.kid, kid))
    .run();
}

// ---------------------------------------------------------------------------
// Account (kara.moe login session)
// ---------------------------------------------------------------------------

/** A row in the singleton `account` table. */
export interface AccountRow {
  id: number;
  username: string;
  token: string;
  onlineToken: string | null;
  role: "guest" | "user" | "admin";
  loggedInAt: string;
}

/** The current login session, or `undefined` when not logged in. */
export function getAccount(): AccountRow | undefined {
  const row = db.select().from(account).where(eq(account.id, 1)).get();
  return row;
}

/** Upsert the singleton `account` row (id=1). */
export function setAccount(row: {
  username: string;
  token: string;
  onlineToken?: string | null;
  role: "guest" | "user" | "admin";
  loggedInAt: string;
}): void {
  db.insert(account)
    .values({
      id: 1,
      username: row.username,
      token: row.token,
      onlineToken: row.onlineToken ?? null,
      role: row.role,
      loggedInAt: row.loggedInAt,
    })
    .onConflictDoUpdate({
      target: account.id,
      set: {
        username: row.username,
        token: row.token,
        onlineToken: row.onlineToken ?? null,
        role: row.role,
        loggedInAt: row.loggedInAt,
      },
    })
    .run();
}

/** Remove the `account` row (log out). */
export function clearAccount(): void {
  db.delete(account).where(eq(account.id, 1)).run();
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** A row in the `collections` table. */
export interface CollectionRow {
  id: string;
  name: string;
  source: "local" | "remote-own" | "remote-subscribed";
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  remoteItemCount: number | null;
  remoteStale: boolean;
}

/**
 * The subset of `remoteKids` that are NOT in the local `songs` table,
 * preserving input order and de-duplicated (first occurrence wins).
 * Thin wrapper over `alreadyDownloadedKids`. Empty input -> empty array;
 * never throws.
 */
export function missingKidsForBulkDownload(remoteKids: string[]): string[] {
  if (!remoteKids.length) return [];
  const have = alreadyDownloadedKids(remoteKids);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const kid of remoteKids) {
    if (seen.has(kid)) continue;
    seen.add(kid);
    if (!have.has(kid)) missing.push(kid);
  }
  return missing;
}
/** All collections ordered by name. */
export function listCollections(): CollectionRow[] {
  return db.select().from(collections).orderBy(collections.name).all();
}

/** All collections with their song count, ordered by name. */
export function listCollectionsWithCounts(): (CollectionRow & { songCount: number })[] {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      source: collections.source,
      ownerUsername: collections.ownerUsername,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      lastSyncedAt: collections.lastSyncedAt,
      remoteItemCount: collections.remoteItemCount,
      remoteStale: collections.remoteStale,
      songCount: sql<number>`count(${collectionSongs.kid})`,
    })
    .from(collections)
    .leftJoin(collectionSongs, eq(collectionSongs.collectionId, collections.id))
    .groupBy(collections.id)
    .orderBy(collections.name)
    .all();
}

/** Create a new local collection. Returns the created row. */
export function createLocalCollection(name: string): CollectionRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(collections)
    .values({
      id,
      name,
      source: "local",
      ownerUsername: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
      remoteItemCount: null,
      remoteStale: false,
    })
    .run();
  return {
    id,
    name,
    source: "local",
    ownerUsername: null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    remoteItemCount: null,
    remoteStale: false,
  };
}

/** Rename a collection (bumps `updatedAt`). */
export function renameCollection(id: string, name: string): void {
  db.update(collections)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(eq(collections.id, id))
    .run();
}

/** Delete a collection. `ON DELETE CASCADE` removes `collection_songs` rows. */
export function deleteCollection(id: string): void {
  db.delete(collections).where(eq(collections.id, id)).run();
}
/** A single row in the `remote_playlist_items` snapshot table. */
export interface RemotePlaylistItem {
  kid: string;
  position: number;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  payload: string | null;
}
/**
 * Upsert a `remote-own` collection keyed by the remote `plaid`. On insert
 * `createdAt` is set; on update only `name`, `ownerUsername`,
 * `remoteItemCount`, `updatedAt` and `lastSyncedAt` change — `createdAt`
 * and `source` are never touched. Returns the resulting row.
 */
export function upsertRemoteOwnPlaylist(
  plaid: string,
  name: string,
  ownerUsername: string | null,
  remoteItemCount: number | null,
): CollectionRow {
  const now = new Date().toISOString();
  db.insert(collections)
    .values({
      id: plaid,
      name,
      source: "remote-own",
      ownerUsername,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      remoteItemCount,
      remoteStale: false,
    })
    .onConflictDoUpdate({
      target: collections.id,
      set: {
        name,
        ownerUsername,
        remoteItemCount,
        updatedAt: now,
        lastSyncedAt: now,
      },
    })
    .run();
  const row = db.select().from(collections).where(eq(collections.id, plaid)).get();
  if (!row) throw new Error(`upsertRemoteOwnPlaylist: row ${plaid} not found after upsert`);
  return row;
}
/**
 * Upsert a `remote-subscribed` collection keyed by the remote `plaid`.
 * On insert `createdAt` is set; on update only `name`, `ownerUsername`,
 * `remoteItemCount`, `updatedAt`, `lastSyncedAt` and `remoteStale`
 * change — `createdAt` and `source` are never touched, so re-subscribing
 * an existing `remote-own` row does not silently convert it. Returns the
 * resulting row.
 */
export function upsertSubscribedCollection(
  plaid: string,
  name: string,
  ownerUsername: string | null,
  remoteItemCount: number | null,
): CollectionRow {
  const now = new Date().toISOString();
  db.insert(collections)
    .values({
      id: plaid,
      name,
      source: "remote-subscribed",
      ownerUsername,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      remoteItemCount,
      remoteStale: false,
    })
    .onConflictDoUpdate({
      target: collections.id,
      set: {
        name,
        ownerUsername,
        remoteItemCount,
        updatedAt: now,
        lastSyncedAt: now,
        remoteStale: false,
      },
    })
    .run();
  const row = db.select().from(collections).where(eq(collections.id, plaid)).get();
  if (!row) throw new Error(`upsertSubscribedCollection: row ${plaid} not found after upsert`);
  return row;
}
/**
 * Mark a collection's remote playlist as stale (no longer public / could
 * not be fetched on the last sync) or clear the flag. Updates only
 * `remote_stale`; does NOT bump `updatedAt`/`lastSyncedAt`. No-op when
 * the row does not exist.
 */
export function setCollectionRemoteStale(id: string, stale: boolean): void {
  db.update(collections)
    .set({ remoteStale: stale })
    .where(eq(collections.id, id))
    .run();
}
/**
 * Replace all membership rows for a collection with the given ordered kids.
 * Deletes every existing `collection_songs` row for the collection, then
 * reinserts each kid with its index as `position`. Bumps `updatedAt`
 * always; bumps `lastSyncedAt` only when `opts.touchSyncedAt` is true.
 * No-op if the collection row does not exist.
 */
export function replaceCollectionMembership(
  collectionId: string,
  orderedKids: string[],
  opts: { touchSyncedAt: boolean },
): void {
  const col = db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!col) return;
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(collectionSongs)
      .where(eq(collectionSongs.collectionId, collectionId))
      .run();
    orderedKids.forEach((kid, position) => {
      tx.insert(collectionSongs)
        .values({ collectionId, kid, position })
        .run();
    });
    const set: Record<string, unknown> = { updatedAt: now };
    if (opts.touchSyncedAt) {
      set.lastSyncedAt = now;
    }
    tx.update(collections).set(set).where(eq(collections.id, collectionId)).run();
  });
}
/**
 * Reorder the songs in a collection. Deletes all membership rows and
 * reinserts them in the given order. Bumps `updatedAt`; bumps
 * `lastSyncedAt` only for non-local collections (a purely local reorder
 * is not a "sync").
 */
export function reorderCollection(collectionId: string, orderedKids: string[]): void {
  const col = db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!col) return;
  replaceCollectionMembership(collectionId, orderedKids, {
    touchSyncedAt: col.source !== "local",
  });
}
/**
 * Replace the full remote playlist snapshot for a collection. Deletes all
 * existing `remote_playlist_items` rows for the collection, then inserts
 * the given items (position taken from `item.position`). Idempotent:
 * calling twice with the same input does not duplicate rows.
 */
export function replaceRemotePlaylistItems(
  collectionId: string,
  items: RemotePlaylistItem[],
): void {
  db.transaction((tx) => {
    tx.delete(remotePlaylistItems)
      .where(eq(remotePlaylistItems.collectionId, collectionId))
      .run();
    items.forEach((item) => {
      tx.insert(remotePlaylistItems)
        .values({
          collectionId,
          kid: item.kid,
          position: item.position,
          title: item.title,
          series: item.series,
          singer: item.singer,
          duration: item.duration,
          payload: item.payload,
        })
        .run();
    });
  });
}
/** All remote playlist items for a collection, ordered by position asc. */
export function getRemotePlaylistItems(collectionId: string): RemotePlaylistItem[] {
  return db
    .select()
    .from(remotePlaylistItems)
    .where(eq(remotePlaylistItems.collectionId, collectionId))
    .orderBy(remotePlaylistItems.position)
    .all();
}
/**
 * Remote playlist items for a collection, each flagged with whether the
 * song is already in the local `songs` table (left join on kid).
 * Ordered by position asc.
 */
export function getRemotePlaylistItemsWithDownloaded(
  collectionId: string,
): (RemotePlaylistItem & { downloaded: boolean })[] {
  const rows = db
    .select({
      item: remotePlaylistItems,
      songKid: songs.kid,
    })
    .from(remotePlaylistItems)
    .leftJoin(songs, eq(remotePlaylistItems.kid, songs.kid))
    .where(eq(remotePlaylistItems.collectionId, collectionId))
    .orderBy(remotePlaylistItems.position)
    .all();
  return rows.map((r) => ({
    kid: r.item.kid,
    position: r.item.position,
    title: r.item.title,
    series: r.item.series,
    singer: r.item.singer,
    duration: r.item.duration,
    payload: r.item.payload,
    downloaded: r.songKid !== null,
  }));
}
/**
 * Delete `remote-own` collections whose `id` (the remote `plaid`) is not in
 * `keepPlaids`. When `keepPlaids` is empty, all `remote-own` rows are
 * deleted. `ON DELETE CASCADE` removes `collection_songs` and
 * `remote_playlist_items` rows only — never `songs` or files.
 *
 * Policy: rows for playlists that vanished upstream are DELETED (not marked
 * stale). The prune is keyed on `plaid` membership in the fetched set
 * rather than `ownerUsername` because with `includeUserAsContributor=true`
 * a contributed playlist's `ownerUsername` is the real owner, not the
 * logged-in user — keying on username would re-create and delete contributed
 * playlists on every sync.
 *
 * Returns the number of deleted collections.
 */
export function pruneRemoteOwnPlaylists(keepPlaids: string[]): number {
  const before = db
    .select({ n: sql<number>`count(*)` })
    .from(collections)
    .where(eq(collections.source, "remote-own"))
    .get()?.n ?? 0;
  if (keepPlaids.length === 0) {
    db.delete(collections).where(eq(collections.source, "remote-own")).run();
  } else {
    db.delete(collections)
      .where(and(eq(collections.source, "remote-own"), notInArray(collections.id, keepPlaids)))
      .run();
  }
  const after = db
    .select({ n: sql<number>`count(*)` })
    .from(collections)
    .where(eq(collections.source, "remote-own"))
    .get()?.n ?? 0;
  return before - after;
}
/** A single collection by id, or undefined if not found. */
export function getCollection(id: string): CollectionRow | undefined {
  return db.select().from(collections).where(eq(collections.id, id)).get();
}

/** Songs in a collection, ordered by position. */
export function getCollectionSongs(collectionId: string): CatalogEntry[] {
  const rows = db
    .select({ song: songs, position: collectionSongs.position })
    .from(collectionSongs)
    .innerJoin(songs, eq(collectionSongs.kid, songs.kid))
    .where(eq(collectionSongs.collectionId, collectionId))
    .orderBy(collectionSongs.position)
    .all();
  return rows.map((r) => rowToEntry(r.song));
}

/** Add a song to a collection at the next position. No-op if already a member. */
export function addSongToCollection(collectionId: string, kid: string): void {
  const maxPos = db
    .select({ val: sql<number>`coalesce(max(${collectionSongs.position}), 0)` })
    .from(collectionSongs)
    .where(eq(collectionSongs.collectionId, collectionId))
    .get()?.val ?? 0;
  db.insert(collectionSongs)
    .values({ collectionId, kid, position: maxPos + 1 })
    .onConflictDoNothing()
    .run();
}
/**
 * Insert a `collection_songs` row for (collectionId, kid) at the given
 * `position`. Idempotent: when a row for that (collectionId, kid) already
 * exists (the composite primary key), its `position` is updated instead of
 * inserting a duplicate. No-op if the collection row does not exist.
 * Does not touch the `songs` table.
 */
export function addSongToCollectionAt(
  collectionId: string,
  kid: string,
  position: number,
): void {
  const col = db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!col) return;
  db.insert(collectionSongs)
    .values({ collectionId, kid, position })
    .onConflictDoUpdate({
      target: [collectionSongs.collectionId, collectionSongs.kid],
      set: { position },
    })
    .run();
}

/** Remove a song from a collection (membership row only; does not touch `songs`). */
export function removeSongFromCollection(collectionId: string, kid: string): void {
  db.delete(collectionSongs)
    .where(
      sql`${collectionSongs.collectionId} = ${collectionId} AND ${collectionSongs.kid} = ${kid}`,
    )
    .run();
}
/** Collections a given song belongs to (id + name). */
export function collectionsForSong(kid: string): { id: string; name: string }[] {
  return db
    .select({ id: collections.id, name: collections.name })
    .from(collectionSongs)
    .innerJoin(collections, eq(collectionSongs.collectionId, collections.id))
    .where(eq(collectionSongs.kid, kid))
    .all();
}

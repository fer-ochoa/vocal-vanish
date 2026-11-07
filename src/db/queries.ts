import { eq, inArray, sql, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./index";
import { songs, collections, collectionSongs, account } from "./schema";

/**
 * A catalog entry persisted locally for a song the app knows about.
 *
 * This is a local re-declaration of the `CatalogEntry` interface defined in
 * `src/index.ts` (and mirrored in `src/preload.ts`). It is re-declared here
 * — rather than imported — to avoid a circular import: `src/index.ts`
 * imports from this file, so importing the type back from `src/index.ts`
 * would create a cycle. The two declarations are kept identical on purpose;
 * the DB column names (`mediaFile`/`mediaSize`/`lyriclessFile`) are mapped
 * to/from the existing field names (`file`/`size`/`lyriclessFile`) inside
 * this file so every call site above and below it is untouched.
 *
 * A row may exist for a song that is NOT downloaded: `file === null` means
 * "not downloaded".
 */
export interface CatalogEntry {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null; // seconds
  file: string | null; // filename of the hardsub video inside the catalog dir; null = not downloaded
  size: number | null; // bytes
  downloadedAt: string | null; // ISO date; null = not downloaded
  lyriclessFile?: string | null; // filename of the lyricless variant, if generated
  /** Language codes of the song, e.g. ["JPN"]. */
  langs?: string[];
  /** True when the song's version is "Off Vocal" (already instrumental). */
  offVocal?: boolean;
  /** Derived: true when the song has a media file (is downloaded). */
  downloaded: boolean;
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
    downloaded: row.mediaFile !== null,
  };
}

/** All songs (downloaded and not), sorted by `downloadedAt` desc with nulls
 *  last, then title. */
export function getAllSongs(): CatalogEntry[] {
  const rows = db
    .select()
    .from(songs)
    .orderBy(sql`CASE WHEN ${songs.downloadedAt} IS NULL THEN 1 ELSE 0 END`, songs.downloadedAt, songs.title)
    .all();
  return rows.map(rowToEntry);
}

/** Only songs that have been downloaded (`media_file IS NOT NULL`). */
export function getDownloadedSongs(): CatalogEntry[] {
  const rows = db
    .select()
    .from(songs)
    .where(sql`${songs.mediaFile} IS NOT NULL`)
    .orderBy(sql`CASE WHEN ${songs.downloadedAt} IS NULL THEN 1 ELSE 0 END`, songs.downloadedAt, songs.title)
    .all();
  return rows.map(rowToEntry);
}

/** A single song by kid, or undefined if not in the catalog. */
export function getSong(kid: string): CatalogEntry | undefined {
  const row = db.select().from(songs).where(eq(songs.kid, kid)).get();
  return row ? rowToEntry(row) : undefined;
}

/** True when the given kid has a media file (is downloaded). */
export function isDownloaded(kid: string): boolean {
  return (
    db
      .select({ kid: songs.kid })
      .from(songs)
      .where(and(eq(songs.kid, kid), sql`${songs.mediaFile} IS NOT NULL`))
      .get() !== undefined
  );
}

/** The subset of `kids` that are already downloaded (have a media file). */
export function alreadyDownloadedKids(kids: string[]): Set<string> {
  if (!kids.length) return new Set();
  const rows = db
    .select({ kid: songs.kid })
    .from(songs)
    .where(and(inArray(songs.kid, kids), sql`${songs.mediaFile} IS NOT NULL`))
    .all();
  return new Set(rows.map((r) => r.kid));
}

/** Insert or update a song row (keyed by kid). Full upsert used by the
 *  download path; sets media_file/media_size/downloaded_at. */
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

/**
 * Insert-or-update metadata-only fields (title/series/singer/duration/langs/
 * off_vocal) for a song. Must NEVER touch media_file/media_size/
 * downloaded_at/lyricless_file on an existing row.
 */
export function upsertSongMetadata(item: ImportedItem): void {
  db.insert(songs)
    .values({
      kid: item.kid,
      title: item.title,
      series: item.series,
      singer: item.singer,
      duration: item.duration,
      mediaFile: null,
      mediaSize: null,
      lyriclessFile: null,
      langs: item.langs,
      offVocal: item.offVocal,
      downloadedAt: null,
    })
    .onConflictDoUpdate({
      target: songs.kid,
      set: {
        title: item.title,
        series: item.series,
        singer: item.singer,
        duration: item.duration,
        langs: item.langs,
        offVocal: item.offVocal,
      },
    })
    .run();
}

/**
 * Clear the download state for a song: sets media_file, media_size,
 * lyricless_file, downloaded_at to NULL. Keeps the row and its memberships.
 */
export function clearSongDownload(kid: string): void {
  db.update(songs)
    .set({
      mediaFile: null,
      mediaSize: null,
      lyriclessFile: null,
      downloadedAt: null,
    })
    .where(eq(songs.kid, kid))
    .run();
}

/** Count of `collection_songs` rows for a given kid. */
export function songCollectionCount(kid: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(collectionSongs)
    .where(eq(collectionSongs.kid, kid))
    .get();
  return row?.n ?? 0;
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
  source: "local" | "imported";
  origin: "own" | "public" | null;
  remotePlaid: string | null;
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  remoteItemCount: number | null;
  remoteStale: boolean;
}

/** A collection row with song counts. */
export interface CollectionRowWithCount extends CollectionRow {
  songCount: number;        // membership rows
  downloadedCount: number;  // membership rows whose song has media_file
}

/** A single item in an imported collection (metadata only). */
export interface ImportedItem {
  kid: string;
  position: number;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  langs: string[];
  offVocal: boolean;
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

/** All collections with their song count and downloaded count, ordered by name. */
export function listCollectionsWithCounts(): CollectionRowWithCount[] {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      source: collections.source,
      origin: collections.origin,
      remotePlaid: collections.remotePlaid,
      ownerUsername: collections.ownerUsername,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      lastSyncedAt: collections.lastSyncedAt,
      remoteItemCount: collections.remoteItemCount,
      remoteStale: collections.remoteStale,
      songCount: sql<number>`count(${collectionSongs.kid})`,
      downloadedCount: sql<number>`count(${songs.mediaFile})`,
    })
    .from(collections)
    .leftJoin(collectionSongs, eq(collectionSongs.collectionId, collections.id))
    .leftJoin(songs, eq(collectionSongs.kid, songs.kid))
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
      origin: null,
      remotePlaid: null,
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
    origin: null,
    remotePlaid: null,
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

/** Find a collection by its remote plaid (the source kara.moe playlist id). */
export function findCollectionByPlaid(plaid: string): CollectionRow | undefined {
  return db
    .select()
    .from(collections)
    .where(eq(collections.remotePlaid, plaid))
    .get();
}

/**
 * Import a kara.moe playlist as a local collection. One transaction:
 * insert the collection (fresh UUID id, source 'imported', remotePlaid =
 * plaid, lastSyncedAt = now, remoteItemCount = items.length), upsert
 * metadata for every item, then replace membership with ALL kids in
 * position order.
 */
export function importCollection(params: {
  plaid: string;
  name: string;
  ownerUsername: string | null;
  origin: "own" | "public";
  items: ImportedItem[];
}): CollectionRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(collections)
      .values({
        id,
        name: params.name,
        source: "imported",
        origin: params.origin,
        remotePlaid: params.plaid,
        ownerUsername: params.ownerUsername,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: now,
        remoteItemCount: params.items.length,
        remoteStale: false,
      })
      .run();
    for (const item of params.items) {
      upsertSongMetadata(item);
    }
    // Replace membership with ALL kids in position order.
    const sorted = [...params.items].sort((a, b) => a.position - b.position);
    sorted.forEach((item, idx) => {
      tx.insert(collectionSongs)
        .values({ collectionId: id, kid: item.kid, position: idx })
        .run();
    });
  });
  const row = db.select().from(collections).where(eq(collections.id, id)).get();
  if (!row) throw new Error(`importCollection: row ${id} not found after insert`);
  return row;
}

/**
 * Sync an imported collection with fresh items from the remote playlist.
 * Same as importCollection minus the collection insert: bumps updatedAt +
 * lastSyncedAt, sets remoteItemCount = items.length, clears remoteStale.
 * Songs that vanished upstream lose their membership row but their `songs`
 * row is kept.
 */
export function syncImportedCollection(id: string, items: ImportedItem[]): void {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const item of items) {
      upsertSongMetadata(item);
    }
    // Replace membership with ALL kids in position order.
    tx.delete(collectionSongs)
      .where(eq(collectionSongs.collectionId, id))
      .run();
    const sorted = [...items].sort((a, b) => a.position - b.position);
    sorted.forEach((item, idx) => {
      tx.insert(collectionSongs)
        .values({ collectionId: id, kid: item.kid, position: idx })
        .run();
    });
    tx.update(collections)
      .set({
        updatedAt: now,
        lastSyncedAt: now,
        remoteItemCount: items.length,
        remoteStale: false,
      })
      .where(eq(collections.id, id))
      .run();
  });
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
/** Collections a given song belongs to (id + name). Only `source = 'local'`
 *  collections are returned. */
export function collectionsForSong(kid: string): { id: string; name: string }[] {
  return db
    .select({ id: collections.id, name: collections.name })
    .from(collectionSongs)
    .innerJoin(collections, eq(collectionSongs.collectionId, collections.id))
    .where(and(eq(collectionSongs.kid, kid), eq(collections.source, "local")))
    .all();
}

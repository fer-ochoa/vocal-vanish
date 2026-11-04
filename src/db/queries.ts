import { eq, inArray, sql, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./index";
import { songs, collections, collectionSongs, account } from "./schema";

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

import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { songs } from "./schema";

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

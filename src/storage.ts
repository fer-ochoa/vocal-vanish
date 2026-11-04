import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { getAllSongs } from "./db/queries";
/**
 * Per-song media layout helpers (feat 02).
 *
 * The catalog directory (`~/.config/vocal-vanish/kara-catalog`, see
 * `CATALOG_DIR()` in `db/index.ts`) now stores each song's media in its own
 * subfolder:
 *
 *   <catalog>/media/<kid>/<mediaFile>        hardsub video
 *   <catalog>/media/<kid>/<lyriclessFile>    lyricless variant (if generated)
 *   <catalog>/tmp/<kid>.part                 in-progress hardsub download
 *   <catalog>/tmp/<kid>.lyricless.part       in-progress lyricless write
 *
 * The DB keeps storing plain basenames in `mediaFile` / `lyriclessFile`;
 * these helpers resolve them against the per-song directory.
 *
 * `migrateFlatFiles()` (below) moves files that older versions of the app
 * wrote flat into the catalog root into the new layout. It imports
 * `getAllSongs` from `db/queries` — that module only depends on `db/index`
 * and `db/schema`, so no circular import is created.
 */
/** Catalog root — same location `CATALOG_DIR()` in `db/index.ts` resolves to.
 *  Re-declared here (rather than imported) to keep this module free of any
 *  dependency on `db/index`. */
export const CATALOG_ROOT = (): string =>
  path.join(app.getPath("userData"), "kara-catalog");
/** Per-song media directory: `<catalog>/media/<kid>`. */
export const mediaDir = (kid: string): string =>
  path.join(CATALOG_ROOT(), "media", kid);
/** In-progress hardsub download: `<catalog>/tmp/<kid>.part`. */
export const tmpPartPath = (kid: string): string =>
  path.join(CATALOG_ROOT(), "tmp", `${kid}.part`);
/** In-progress lyricless write: `<catalog>/tmp/<kid>.lyricless.part`. */
export const tmpLyriclessPartPath = (kid: string): string =>
  path.join(CATALOG_ROOT(), "tmp", `${kid}.lyricless.part`);
/** Create the per-song media directory (and parents) if missing. */
export const ensureMediaDir = (kid: string): string => {
  const dir = mediaDir(kid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
/** Create the shared tmp directory if missing. */
export const ensureTmpDir = (): string => {
  const dir = path.join(CATALOG_ROOT(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
/**
 * Remove stale in-progress files left behind by interrupted downloads /
 * lyricless writes. Runs at startup; safe to call whenever.
 */
export function cleanupTmp(): void {
  const dir = path.join(CATALOG_ROOT(), "tmp");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return; // no tmp dir — nothing to clean
  }
  for (const name of names) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* ignore individual failures */
    }
  }
}
/**
 * One-off migration of the legacy flat layout: move each song's
 * `mediaFile` / `lyriclessFile` from the catalog root into
 * `media/<kid>/`. Idempotent — a file already in its per-song directory is
 * skipped, and a stored name that is not a plain basename (contains a path
 * separator) is left untouched. Returns the number of files moved.
 */
export function migrateFlatFiles(): number {
  let moved = 0;
  for (const entry of getAllSongs()) {
    for (const name of [entry.file, entry.lyriclessFile]) {
      if (!name) continue;
      // Path-safety: only migrate plain basenames.
      if (name !== path.basename(name)) continue;
      const src = path.join(CATALOG_ROOT(), name);
      const dest = path.join(mediaDir(entry.kid), name);
      if (!fs.existsSync(src)) continue; // already migrated (or missing)
      if (fs.existsSync(dest)) continue; // destination wins; leave src alone
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(src, dest);
        moved += 1;
      } catch {
        /* leave the file where it is; the song just won't play until the
           next run retries (or the user re-downloads) */
      }
    }
  }
  return moved;
}

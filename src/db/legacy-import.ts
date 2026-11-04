import * as fs from "fs";
import * as path from "path";
import { db, CATALOG_DIR } from "./index";
import { songs } from "./schema";
import { upsertSong } from "./queries";
import type { CatalogEntry } from "./queries";

/**
 * One-off import of the legacy flat `catalog.json` index into the SQLite
 * `songs` table. Runs once at startup, before `registerIpc()`:
 *
 *   1. If the `songs` table already has rows -> no-op (idempotent; a second
 *      launch after the first import must not duplicate rows).
 *   2. Else, if `catalog.json` exists in the catalog dir -> read it and
 *      insert one `songs` row per entry. No file moves: `mediaFile` is the
 *      entry's existing `file` value, so files stay exactly where they are.
 *   3. Once the import finishes without error, rename `catalog.json` to
 *      `catalog.json.bak` (kept on disk, not deleted).
 *   4. Fresh install (no legacy file) -> no-op.
 */
export function runLegacyImport(): void {
  // (1) Already imported? Nothing to do.
  const existing = db.select({ kid: songs.kid }).from(songs).all();
  if (existing.length > 0) return;

  // (2) Is there a legacy catalog.json to import?
  const legacyFile = path.join(CATALOG_DIR(), "catalog.json");
  if (!fs.existsSync(legacyFile)) return; // (4) fresh install

  let raw: string;
  try {
    raw = fs.readFileSync(legacyFile, "utf8");
  } catch {
    return; // unreadable legacy file — leave it alone, start fresh
  }

  let index: Record<string, CatalogEntry>;
  try {
    index = JSON.parse(raw) as Record<string, CatalogEntry>;
  } catch {
    return; // corrupt legacy file — leave it alone, start fresh
  }

  // Insert one row per entry.
  for (const entry of Object.values(index)) {
    if (!entry || !entry.kid) continue;
    upsertSong(entry);
  }

  // (3) Import succeeded — park the legacy file so it is never read again.
  try {
    fs.renameSync(legacyFile, legacyFile + ".bak");
  } catch {
    /* if the rename fails the rows are already in the DB; next launch the
       row-count check above makes this a no-op, so it is safe to ignore */
  }
}

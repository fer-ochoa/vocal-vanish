import { migrateFlatFiles } from "../storage";
/**
 * One-off startup migration of the legacy flat media layout into the
 * per-song `media/<kid>/` folders (feat 02). Runs once at startup, after
 * `runLegacyImport()` (the DB must be populated before we know which files
 * to move) and before `registerIpc()`:
 *
 *   1. `migrateFlatFiles()` moves each song's flat `mediaFile` /
 *      `lyriclessFile` from the catalog root into `media/<kid>/`.
 *   2. Idempotent: files already in their per-song directory are skipped,
 *      so a second launch is a no-op.
 *
 * Kept in its own module (rather than inlined in `src/index.ts`) because it
 * needs both `storage.ts` and the DB queries; `index.ts` just calls it.
 */
export function runLegacyFolderMigration(): void {
  migrateFlatFiles();
}

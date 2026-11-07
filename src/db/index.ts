import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import * as schema from "./schema";

/**
 * Local catalog directory — same location `src/index.ts` uses for the
 * downloaded video files (flat layout, unchanged by this refactor).
 * Computed independently here to avoid a circular import with index.ts.
 */
export const CATALOG_DIR = (): string =>
  path.join(app.getPath("userData"), "kara-catalog");

const DB_PATH = (): string => path.join(CATALOG_DIR(), "library.db");

function openDb() {
  // The DB lives inside the catalog dir; make sure it exists before
  // better-sqlite3 tries to open the file (today ensureCatalogDir() in
  // index.ts is only called lazily).
  fs.mkdirSync(CATALOG_DIR(), { recursive: true });
  const sqlite = new Database(DB_PATH());
  sqlite.pragma("journal_mode = WAL");
  // Disable FK enforcement for the duration of the migration: dropping
  // `songs` / `collections` would otherwise cascade away `collection_songs`.
  sqlite.pragma("foreign_keys = OFF");

  // No drizzle-kit / no migrations: idempotent DDL run on every startup.
  // Step A — create tables with the NEW shape (no-ops if they already exist).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      kid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      series TEXT NOT NULL DEFAULT '',
      singer TEXT NOT NULL DEFAULT '',
      duration INTEGER,
      media_file TEXT,
      media_size INTEGER,
      lyricless_file TEXT,
      thumbnail_file TEXT,
      langs TEXT,
      off_vocal INTEGER NOT NULL DEFAULT 0,
      downloaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('local','imported')),
      origin TEXT CHECK (origin IN ('own','public')),
      remote_plaid TEXT,
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_synced_at TEXT,
      remote_item_count INTEGER,
      remote_stale INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS collection_songs (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      kid TEXT NOT NULL REFERENCES songs(kid) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (collection_id, kid)
    );

    CREATE TABLE IF NOT EXISTS account (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      token TEXT NOT NULL,
      online_token TEXT,
      role TEXT NOT NULL CHECK (role IN ('guest','user','admin')),
      logged_in_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_collection_songs_kid ON collection_songs(kid);
  `);

  // Step B — migrate `songs` if the old schema has media_file NOT NULL.
  const songCols = sqlite
    .prepare("PRAGMA table_info(songs)")
    .all() as { name: string; notnull: number }[];
  const mediaFileCol = songCols.find((c) => c.name === "media_file");
  if (mediaFileCol && mediaFileCol.notnull === 1) {
    sqlite.exec(`
      CREATE TABLE songs_new (
        kid TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        series TEXT NOT NULL DEFAULT '',
        singer TEXT NOT NULL DEFAULT '',
        duration INTEGER,
        media_file TEXT,
        media_size INTEGER,
        lyricless_file TEXT,
        thumbnail_file TEXT,
        langs TEXT,
        off_vocal INTEGER NOT NULL DEFAULT 0,
        downloaded_at TEXT
      );
      INSERT INTO songs_new
        SELECT kid, title, series, singer, duration, media_file,
               media_size, lyricless_file, thumbnail_file, langs,
               off_vocal, downloaded_at
        FROM songs;
      DROP TABLE songs;
      ALTER TABLE songs_new RENAME TO songs;
      CREATE INDEX IF NOT EXISTS idx_collection_songs_kid ON collection_songs(kid);
    `);
  }

  // Step C — migrate `collections` if the old schema lacks remote_plaid.
  const collCols = sqlite
    .prepare("PRAGMA table_info(collections)")
    .all() as { name: string }[];
  const hasRemotePlaid = collCols.some((c) => c.name === "remote_plaid");
  let collMapExists = false;
  if (!hasRemotePlaid) {
    // 1. Build the old→new id map (local collections keep their id).
    sqlite.exec(`
      CREATE TEMP TABLE coll_map (
        old_id TEXT PRIMARY KEY,
        new_id TEXT NOT NULL
      );
      INSERT INTO coll_map (old_id, new_id)
        SELECT id,
               CASE WHEN source = 'local' THEN id
                    ELSE lower(hex(randomblob(16)))
               END
        FROM collections;
    `);
    collMapExists = true;
    // 2. Create the new collections table and fill it from the map.
    sqlite.exec(`
      CREATE TABLE collections_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('local','imported')),
        origin TEXT CHECK (origin IN ('own','public')),
        remote_plaid TEXT,
        owner_username TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        remote_item_count INTEGER,
        remote_stale INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO collections_new
        (id, name, source, origin, remote_plaid, owner_username,
         created_at, updated_at, last_synced_at, remote_item_count, remote_stale)
        SELECT
          m.new_id,
          c.name,
          CASE WHEN c.source = 'local' THEN 'local' ELSE 'imported' END,
          CASE
            WHEN c.source = 'local' THEN NULL
            WHEN c.source = 'remote-own' THEN 'own'
            WHEN c.source = 'remote-subscribed' THEN 'public'
            ELSE NULL
          END,
          CASE WHEN c.source = 'local' THEN NULL ELSE c.id END,
          c.owner_username,
          c.created_at,
          c.updated_at,
          c.last_synced_at,
          c.remote_item_count,
          c.remote_stale
        FROM collections c
        JOIN coll_map m ON m.old_id = c.id;
    `);
    // 3. Remap collection_songs membership to the new ids.
    sqlite.exec(`
      UPDATE collection_songs
        SET collection_id = (
          SELECT new_id FROM coll_map WHERE old_id = collection_songs.collection_id
        );
    `);
    // 4. Swap the tables and recreate the unique index.
    sqlite.exec(`
      DROP TABLE collections;
      ALTER TABLE collections_new RENAME TO collections;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_remote_plaid
        ON collections(remote_plaid) WHERE remote_plaid IS NOT NULL;
    `);
  }

  // Step D — materialize the old remote_playlist_items snapshot into the
  // new model (songs metadata + collection_songs membership), then drop it.
  const rpiExists =
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remote_playlist_items'",
      )
      .get() !== undefined;
  if (rpiExists) {
    const rpiRows = sqlite
      .prepare(
        `SELECT collection_id, kid, position, title, series, singer, duration, payload
         FROM remote_playlist_items`,
      )
      .all() as {
      collection_id: string;
      kid: string;
      position: number;
      title: string;
      series: string;
      singer: string;
      duration: number | null;
      payload: string | null;
    }[];

    // Resolve each old collection_id to its new id via coll_map (if present).
    const resolveCollId = (oldId: string): string => {
      if (collMapExists) {
        const row = sqlite
          .prepare("SELECT new_id FROM coll_map WHERE old_id = ?")
          .get(oldId) as { new_id: string } | undefined;
        return row ? row.new_id : oldId;
      }
      return oldId;
    };

    // Derive langs / off_vocal from the payload JSON.
    const OFF_VOCAL_TID = "c0cc87b9-55b9-40f0-878a-fbb9e34c151e";
    const deriveFromPayload = (payload: string | null): {
      langs: string | null;
      offVocal: number;
    } => {
      if (!payload) return { langs: null, offVocal: 0 };
      try {
        const p = JSON.parse(payload);
        let langs: string | null = null;
        if (Array.isArray(p.langs)) {
          const codes = p.langs
            .map((l: { short?: string; name?: string }) =>
              (l.short || l.name || "").toUpperCase(),
            )
            .filter((s: string) => s.length > 0);
          if (codes.length) langs = JSON.stringify(codes);
        }
        let offVocal = 0;
        if (Array.isArray(p.versions)) {
          offVocal = p.versions.some(
            (v: { tid?: string; name?: string }) =>
              v.tid === OFF_VOCAL_TID ||
              (v.name || "").toLowerCase().replace(/[\s_-]/g, "") === "offvocal",
          )
            ? 1
            : 0;
        }
        return { langs, offVocal };
      } catch {
        return { langs: null, offVocal: 0 };
      }
    };

    const insertSong = sqlite.prepare(
      `INSERT OR IGNORE INTO songs
         (kid, title, series, singer, duration, media_file, media_size,
          lyricless_file, thumbnail_file, langs, off_vocal, downloaded_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
    );
    // Only fill langs where NULL; only upgrade off_vocal 0→1 (never downgrade).
    const updateSongMeta = sqlite.prepare(
      `UPDATE songs SET
         langs = COALESCE(langs, ?),
         off_vocal = CASE WHEN off_vocal = 0 THEN ? ELSE off_vocal END
       WHERE kid = ?`,
    );
    const deleteMembership = sqlite.prepare(
      `DELETE FROM collection_songs WHERE collection_id = ?`,
    );
    const insertMembership = sqlite.prepare(
      `INSERT OR IGNORE INTO collection_songs (collection_id, kid, position)
       VALUES (?, ?, ?)`,
    );

    const tx = sqlite.transaction(() => {
      const cleared = new Set<string>();
      for (const row of rpiRows) {
        const newCollId = resolveCollId(row.collection_id);
        const { langs, offVocal } = deriveFromPayload(row.payload);
        insertSong.run(
          row.kid, row.title, row.series, row.singer, row.duration,
          langs, offVocal,
        );
        updateSongMeta.run(langs, offVocal, row.kid);
        if (!cleared.has(newCollId)) {
          deleteMembership.run(newCollId);
          cleared.add(newCollId);
        }
        insertMembership.run(newCollId, row.kid, row.position);
      }
    });
    tx();

    sqlite.exec("DROP TABLE remote_playlist_items");
  }

  // Clean up coll_map if it was created in step C.
  if (collMapExists) {
    sqlite.exec("DROP TABLE IF EXISTS coll_map");
  }

  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db = openDb();
export const sqlite = (db as { $client: Database.Database }).$client;

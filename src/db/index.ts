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
  sqlite.pragma("foreign_keys = ON");
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
      last_synced_at TEXT
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
export const sqlite = (db as { $client: Database.Database }).$client;

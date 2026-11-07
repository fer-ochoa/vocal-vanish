'use strict';

/*
 * db-smoke-test.js
 *
 * Proves the schema refactor in src/db/index.ts (openDb()) + the new query
 * layer actually work at runtime, by exercising the raw migration SQL
 * against a throwaway database built with the OLD schema.
 *
 * The migration SQL below is a faithful TRANSCRIPTION of the
 * sqlite.exec(...) template literals and sqlite.prepare(...) statements
 * exactly as they appear in src/db/index.ts (not hand-rederived).
 *
 * Run:  /home/fer/.nvm/versions/node/v26.6.0/bin/node .scratch/db-smoke-test.js
 */

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// 1. Load better-sqlite3. If the native module fails under plain node,
//    report it clearly and STOP (do not fake results).
// ---------------------------------------------------------------------------
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('FATAL: better-sqlite3 failed to load under plain node.');
  console.error('The runtime test could NOT be run.');
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. Temp DB file under .scratch/
// ---------------------------------------------------------------------------
const DB_FILE = path.join(__dirname, 'smoke-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(DB_FILE + suffix); } catch (_) { /* ignore */ }
}
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// 3. Build the OLD schema by hand
// ---------------------------------------------------------------------------
sqlite.exec(`
  CREATE TABLE songs (
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
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('local','remote-own','remote-subscribed')),
    owner_username TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT,
    remote_item_count INTEGER,
    remote_stale INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE collection_songs (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    kid TEXT NOT NULL REFERENCES songs(kid) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (collection_id, kid)
  );
  CREATE TABLE remote_playlist_items (
    collection_id TEXT NOT NULL,
    kid TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    series TEXT,
    singer TEXT,
    duration INTEGER,
    payload TEXT,
    PRIMARY KEY (collection_id, kid)
  );
`);

// ---------------------------------------------------------------------------
// 4. Seed a realistic fixture
// ---------------------------------------------------------------------------
const OWN_PLAID = 'plaid-own-123';
const SUB_PLAID = 'plaid-sub-456';

// 2 downloaded songs (media_file + downloaded_at set)
const insSong = sqlite.prepare(`
  INSERT INTO songs (kid, title, series, singer, duration, media_file,
                     media_size, lyricless_file, thumbnail_file, langs,
                     off_vocal, downloaded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?)
`);
insSong.run('kid-1', 'Song One', 'Series A', 'Singer X', 180, 'kid-1.mp4', 12345, '2026-01-01T00:00:00Z');
insSong.run('kid-2', 'Song Two', 'Series B', 'Singer Y', 200, 'kid-2.mp4', 23456, '2026-01-02T00:00:00Z');

// 1 local collection containing both songs
sqlite.prepare(`
  INSERT INTO collections (id, name, source, owner_username, created_at,
                           updated_at, last_synced_at, remote_item_count, remote_stale)
  VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, 0)
`).run('coll-local', 'My Local', 'local', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
const insMember = sqlite.prepare(
  'INSERT INTO collection_songs (collection_id, kid, position) VALUES (?, ?, ?)'
);
insMember.run('coll-local', 'kid-1', 0);
insMember.run('coll-local', 'kid-2', 1);

// 1 remote-own collection (id = a fake plaid)
sqlite.prepare(`
  INSERT INTO collections (id, name, source, owner_username, created_at,
                           updated_at, last_synced_at, remote_item_count, remote_stale)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`).run(OWN_PLAID, 'My Remote Own', 'remote-own', 'someuser',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 3);
// 1 downloaded song in collection_songs
insMember.run(OWN_PLAID, 'kid-1', 0);
// 3 rows in remote_playlist_items (1 downloaded + 2 not downloaded)
const insRpi = sqlite.prepare(`
  INSERT INTO remote_playlist_items (collection_id, kid, position, title,
                                     series, singer, duration, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const payload1 = JSON.stringify({ titles: ['Song One'], series: 'Series A', singers: ['Singer X'], duration: 180, langs: [{ short: 'JPN' }] });
const payload2 = JSON.stringify({ titles: ['Song Three'], series: 'Series C', singers: ['Singer Z'], duration: 220, langs: [{ short: 'JPN' }] });
const payload3 = JSON.stringify({ titles: ['Song Four'], series: 'Series D', singers: ['Singer W'], duration: 240, langs: [{ short: 'JPN' }], versions: [{ tid: 'c0cc87b9-55b9-40f0-878a-fbb9e34c151e', name: 'Off Vocal' }] });
insRpi.run(OWN_PLAID, 'kid-1', 0, 'Song One', 'Series A', 'Singer X', 180, payload1);
insRpi.run(OWN_PLAID, 'kid-3', 1, 'Song Three', 'Series C', 'Singer Z', 220, payload2);
insRpi.run(OWN_PLAID, 'kid-4', 2, 'Song Four', 'Series D', 'Singer W', 240, payload3);

// 1 remote-subscribed collection with 1 snapshot row
sqlite.prepare(`
  INSERT INTO collections (id, name, source, owner_username, created_at,
                           updated_at, last_synced_at, remote_item_count, remote_stale)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`).run(SUB_PLAID, 'Subscribed Playlist', 'remote-subscribed', 'otheruser',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1);
const payload4 = JSON.stringify({ titles: ['Song Five'], series: 'Series E', singers: ['Singer V'], duration: 260, langs: [{ short: 'JPN' }] });
insRpi.run(SUB_PLAID, 'kid-5', 0, 'Song Five', 'Series E', 'Singer V', 260, payload4);

// ---------------------------------------------------------------------------
// 5+6. The migration — transcribed EXACTLY from src/db/index.ts openDb()
// ---------------------------------------------------------------------------
function runMigration() {
  sqlite.pragma('foreign_keys = OFF');

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
    .all();
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
    .all();
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
      .all();
    // Resolve each old collection_id to its new id via coll_map (if present).
    const resolveCollId = (oldId) => {
      if (collMapExists) {
        const row = sqlite
          .prepare("SELECT new_id FROM coll_map WHERE old_id = ?")
          .get(oldId);
        return row ? row.new_id : oldId;
      }
      return oldId;
    };
    // Derive langs / off_vocal from the payload JSON.
    const OFF_VOCAL_TID = "c0cc87b9-55b9-40f0-878a-fbb9e34c151e";
    function deriveFromPayload(payload) {
      if (!payload) return { langs: null, offVocal: 0 };
      try {
        const p = JSON.parse(payload);
        let langs = null;
        if (Array.isArray(p.langs)) {
          const codes = p.langs
            .map((l) => (l.short || l.name || "").toUpperCase())
            .filter((s) => s.length > 0);
          if (codes.length) langs = JSON.stringify(codes);
        }
        let offVocal = 0;
        if (Array.isArray(p.versions)) {
          offVocal = p.versions.some(
            (v) =>
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
    }
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
      const cleared = new Set();
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
  sqlite.pragma('foreign_keys = ON');
}

// Run the migration against the seeded old DB.
let migrationError = null;
try {
  runMigration();
} catch (e) {
  migrationError = e;
}

if (migrationError) {
  console.error('FATAL: Migration failed at runtime.');
  console.error('Error:', migrationError.message);
  console.error('Stack:', migrationError.stack);
  console.error('\nThis is a genuine blocker: the migration SQL in src/db/index.ts');
  console.error('cannot run against the old schema. The likely cause is Step A\'s');
  console.error('  CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_remote_plaid');
  console.error('    ON collections(remote_plaid) WHERE remote_plaid IS NOT NULL;');
  console.error('which fails because the old `collections` table has no `remote_plaid`');
  console.error('column (CREATE TABLE IF NOT EXISTS is a no-op, but the index DDL is not).');
  console.error('\nFix: move that index creation out of Step A and into Step C,');
  console.error('after the collections table is rebuilt with the remote_plaid column.');
  sqlite.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 7. Assertions
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// songs.media_file is now nullable
const songInfo = sqlite.prepare("PRAGMA table_info(songs)").all();
const mf = songInfo.find((c) => c.name === 'media_file');
check('songs.media_file is now nullable', !!mf && mf.notnull === 0, `notnull=${mf && mf.notnull}`);

// collections has remote_plaid and origin columns
const collInfo = sqlite.prepare("PRAGMA table_info(collections)").all();
check('collections has remote_plaid column', collInfo.some((c) => c.name === 'remote_plaid'));
check('collections has origin column', collInfo.some((c) => c.name === 'origin'));

// source CHECK accepts 'imported' (direct insert, then clean up)
let checkAcceptsImported = false;
try {
  sqlite.prepare(
    "INSERT INTO collections (id, name, source, origin, created_at, updated_at) " +
    "VALUES ('__check_test__', 't', 'imported', 'own', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
  ).run();
  sqlite.prepare("DELETE FROM collections WHERE id = '__check_test__'").run();
  checkAcceptsImported = true;
} catch (e) {
  checkAcceptsImported = false;
}
check("source CHECK accepts 'imported' (direct insert)", checkAcceptsImported);

// the local collection kept its original id
const localRow = sqlite.prepare("SELECT * FROM collections WHERE id = 'coll-local'").get();
check('local collection kept its original id', !!localRow && localRow.source === 'local', JSON.stringify(localRow));
const localKids = sqlite.prepare("SELECT kid FROM collection_songs WHERE collection_id = 'coll-local' ORDER BY position").all().map((r) => r.kid);
check('local collection still has both songs', JSON.stringify(localKids) === JSON.stringify(['kid-1', 'kid-2']), JSON.stringify(localKids));

// the remote-own collection became imported/own with a NEW id
const ownRow = sqlite.prepare("SELECT * FROM collections WHERE remote_plaid = ?").get(OWN_PLAID);
check('remote-own: source=imported', !!ownRow && ownRow.source === 'imported', JSON.stringify(ownRow));
check('remote-own: origin=own', !!ownRow && ownRow.origin === 'own');
check('remote-own: remote_plaid = old id', !!ownRow && ownRow.remote_plaid === OWN_PLAID);
check('remote-own: got a NEW id', !!ownRow && ownRow.id !== OWN_PLAID, `id=${ownRow && ownRow.id}`);

// the remote-subscribed collection became imported/public
const subRow = sqlite.prepare("SELECT * FROM collections WHERE remote_plaid = ?").get(SUB_PLAID);
check('remote-subscribed: source=imported', !!subRow && subRow.source === 'imported', JSON.stringify(subRow));
check('remote-subscribed: origin=public', !!subRow && subRow.origin === 'public');
check('remote-subscribed: remote_plaid = old id', !!subRow && subRow.remote_plaid === SUB_PLAID);

// collection_songs remapped to new ids + all 3 snapshot kids
const ownKids = sqlite.prepare("SELECT kid FROM collection_songs WHERE collection_id = ? ORDER BY position").all(ownRow ? ownRow.id : '__none__').map((r) => r.kid);
check('remote-own collection_songs has all 3 snapshot kids', JSON.stringify(ownKids) === JSON.stringify(['kid-1', 'kid-3', 'kid-4']), JSON.stringify(ownKids));
const subKids = sqlite.prepare("SELECT kid FROM collection_songs WHERE collection_id = ? ORDER BY position").all(subRow ? subRow.id : '__none__').map((r) => r.kid);
check('remote-subscribed collection_songs has its snapshot kid', JSON.stringify(subKids) === JSON.stringify(['kid-5']), JSON.stringify(subKids));

// the 2 not-downloaded kids exist in songs with media_file NULL + right metadata
const kid3 = sqlite.prepare("SELECT * FROM songs WHERE kid = 'kid-3'").get();
check('kid-3 exists with media_file NULL', !!kid3 && kid3.media_file === null, JSON.stringify(kid3));
check('kid-3 metadata correct', !!kid3 && kid3.title === 'Song Three' && kid3.series === 'Series C' && kid3.singer === 'Singer Z' && kid3.duration === 220, JSON.stringify(kid3));
const kid4 = sqlite.prepare("SELECT * FROM songs WHERE kid = 'kid-4'").get();
check('kid-4 exists with media_file NULL', !!kid4 && kid4.media_file === null, JSON.stringify(kid4));
check('kid-4 metadata correct', !!kid4 && kid4.title === 'Song Four' && kid4.series === 'Series D' && kid4.singer === 'Singer W' && kid4.duration === 240, JSON.stringify(kid4));

// off_vocal
check('kid-4 off_vocal = 1', !!kid4 && kid4.off_vocal === 1, `off_vocal=${kid4 && kid4.off_vocal}`);
const othersZero = ['kid-1', 'kid-2', 'kid-3', 'kid-5'].every((k) => {
  const r = sqlite.prepare("SELECT off_vocal FROM songs WHERE kid = ?").get(k);
  return !!r && r.off_vocal === 0;
});
check('kid-1/2/3/5 off_vocal = 0', othersZero);

// langs is a JSON array string like ["JPN"]
const langsOk = ['kid-1', 'kid-3', 'kid-4', 'kid-5'].every((k) => {
  const r = sqlite.prepare("SELECT langs FROM songs WHERE kid = ?").get(k);
  return !!r && r.langs === '["JPN"]';
});
check('langs is ["JPN"] for materialized songs', langsOk);

// previously downloaded songs intact (not clobbered)
const kid1 = sqlite.prepare("SELECT * FROM songs WHERE kid = 'kid-1'").get();
check('kid-1 media_file intact', !!kid1 && kid1.media_file === 'kid-1.mp4', `media_file=${kid1 && kid1.media_file}`);
check('kid-1 downloaded_at intact', !!kid1 && kid1.downloaded_at === '2026-01-01T00:00:00Z', `downloaded_at=${kid1 && kid1.downloaded_at}`);
const kid2 = sqlite.prepare("SELECT * FROM songs WHERE kid = 'kid-2'").get();
check('kid-2 media_file intact', !!kid2 && kid2.media_file === 'kid-2.mp4', `media_file=${kid2 && kid2.media_file}`);
check('kid-2 downloaded_at intact', !!kid2 && kid2.downloaded_at === '2026-01-02T00:00:00Z', `downloaded_at=${kid2 && kid2.downloaded_at}`);

// remote_playlist_items no longer exists
const rpiGone = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='remote_playlist_items'").get() === undefined;
check('remote_playlist_items no longer exists', rpiGone);

// running the migration a SECOND time is a no-op
const countsBefore = {
  songs: sqlite.prepare("SELECT COUNT(*) n FROM songs").get().n,
  collections: sqlite.prepare("SELECT COUNT(*) n FROM collections").get().n,
  collection_songs: sqlite.prepare("SELECT COUNT(*) n FROM collection_songs").get().n,
};
runMigration();
const countsAfter = {
  songs: sqlite.prepare("SELECT COUNT(*) n FROM songs").get().n,
  collections: sqlite.prepare("SELECT COUNT(*) n FROM collections").get().n,
  collection_songs: sqlite.prepare("SELECT COUNT(*) n FROM collection_songs").get().n,
};
check('second migration run is a no-op (same counts)',
  countsBefore.songs === countsAfter.songs &&
  countsBefore.collections === countsAfter.collections &&
  countsBefore.collection_songs === countsAfter.collection_songs,
  `before=${JSON.stringify(countsBefore)} after=${JSON.stringify(countsAfter)}`);
const dupKids = sqlite.prepare("SELECT kid, COUNT(*) n FROM songs GROUP BY kid HAVING n > 1").all();
check('no duplicate song rows after second run', dupKids.length === 0, JSON.stringify(dupKids));
const dupColl = sqlite.prepare("SELECT id, COUNT(*) n FROM collections GROUP BY id HAVING n > 1").all();
check('no duplicate collection rows after second run', dupColl.length === 0, JSON.stringify(dupColl));

// PRAGMA foreign_key_check returns no rows
const fkViolations = sqlite.prepare("PRAGMA foreign_key_check").all();
check('PRAGMA foreign_key_check returns no rows', fkViolations.length === 0, JSON.stringify(fkViolations));

// ---------------------------------------------------------------------------
// 8. Final summary
// ---------------------------------------------------------------------------
console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
sqlite.close();
process.exit(failed > 0 ? 1 : 0);

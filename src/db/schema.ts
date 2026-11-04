import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * One row per downloaded song. This is the entire "do I have this song, and
 * where" bookkeeping table — equivalent to today's catalog.json, but as SQL
 * rows instead of a hand-maintained JSON object. The primary key is kara.moe's
 * own `kid` (UUID).
 */
export const songs = sqliteTable("songs", {
  kid: text("kid").primaryKey(),
  title: text("title").notNull(),
  series: text("series").notNull().default(""),
  singer: text("singer").notNull().default(""),
  duration: integer("duration"), // seconds; nullable (kara.moe can omit it)
  mediaFile: text("media_file").notNull(), // filename of the hardsub video inside the catalog dir
  mediaSize: integer("media_size"), // bytes
  lyriclessFile: text("lyricless_file"), // filename of the lyricless variant, or null
  thumbnailFile: text("thumbnail_file"), // filename of the thumbnail, or null (future)
  langs: text("langs", { mode: "json" }).$type<string[]>(), // e.g. ["JPN"]; JSON text column
  offVocal: integer("off_vocal", { mode: "boolean" })
    .notNull()
    .default(false),
  downloadedAt: text("downloaded_at").notNull(), // ISO 8601 string
});

/**
 * One row per collection the app knows about: the user's own (synced from
 * kara.moe after login), other users' public collections the user has
 * browsed/subscribed to, and purely local ones created in-app.
 */
export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source", {
    enum: ["local", "remote-own", "remote-subscribed"],
  }).notNull(),
  ownerUsername: text("owner_username"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastSyncedAt: text("last_synced_at"),
});

/**
 * Many-to-many join table: which songs belong to which collections, and in
 * what order. Deleting a collection cascades here (removes membership rows
 * only). Deleting a song cascades here too.
 */
export const collectionSongs = sqliteTable(
  "collection_songs",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    kid: text("kid")
      .notNull()
      .references(() => songs.kid, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.kid] }),
  }),
);

/**
 * Singleton row (id is always 1) holding the current kara.moe login session,
 * if any. Absence of a row means "not logged in".
 */
export const account = sqliteTable("account", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  token: text("token").notNull(),
  onlineToken: text("online_token"),
  role: text("role", { enum: ["guest", "user", "admin"] }).notNull(),
  loggedInAt: text("logged_in_at").notNull(),
});

import { contextBridge, ipcRenderer } from 'electron';

// Types shared with the main process (kept in sync with src/index.ts).
export interface SearchRow {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  size: number | null;
  /** Language codes of the song, e.g. ['JPN']. */
  langs: string[];
  /** True when the song's version is 'Off Vocal' (already instrumental). */
  offVocal: boolean;
  /** True when this kid is already present in the local catalog. */
  downloaded: boolean;
}

/**
 * A song the app knows about. A row may exist for a song that is NOT
 * downloaded: `file === null` (and `downloadedAt === null`) means "not
 * downloaded". `downloaded` is derived from `file !== null`.
 */
export interface CatalogEntry {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  /** Filename of the hardsub video inside the catalog dir; null = not downloaded. */
  file: string | null;
  size: number | null;
  /** ISO date; null = not downloaded. */
  downloadedAt: string | null;
  lyriclessFile?: string | null;
  /** Language codes of the song, e.g. ['JPN']. Undefined until backfilled. */
  langs?: string[];
  /** True when the song's version is 'Off Vocal' (already instrumental). */
  offVocal?: boolean;
  /** Derived: true when the song has a media file (is downloaded). */
  downloaded: boolean;
}

export interface LyriclessStatus {
  exists: boolean;
  file?: string;
}

export interface DownloadProgress {
  kid: string;
  received: number;
  total: number | null;
}

/** Persisted app settings (mirrors AppSettings in src/index.ts). */
export interface AppSettings {
  /** unblend model id used to generate lyricless videos. */
  separationModel: string;
}
/**
 * A collection row (mirrors CollectionRow in src/db/queries.ts).
 *
 * `local` collections are created in-app and are editable. `imported`
 * collections are local, READ-ONLY copies of a kara.moe playlist: they store
 * the source `remotePlaid` plus the metadata of every song in it, and the only
 * mutations are Sync (re-pull from the source) and Download (per song or bulk).
 */
export interface CollectionRow {
  id: string;
  name: string;
  source: 'local' | 'imported';
  /** Provenance of an imported collection; null for local ones. */
  origin: 'own' | 'public' | null;
  /** Source kara.moe playlist id; null for local collections. */
  remotePlaid: string | null;
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  remoteItemCount: number | null;
  /** True when the remote playlist is no longer reachable (deleted / made private). */
  remoteStale: boolean;
}
/** A collection row with its song counts (from `kara:collections-list`). */
export interface CollectionRowWithCount extends CollectionRow {
  /** Membership rows (downloaded or not). */
  songCount: number;
  /** Membership rows whose song has a media file. */
  downloadedCount: number;
}
/** Allowed `order` values for the kara.moe playlist list (mirrors PlaylistOrder in src/kara-api.ts). */
export type PlaylistOrder = 'az' | 'recent' | 'karacount' | 'duration' | 'username';
/** A public playlist as returned by the kara.moe API (mirrors RemotePlaylist in src/kara-api.ts). */
export interface RemotePlaylist {
  plaid: string;
  name: string;
  description?: string | null;
  slug?: string | null;
  karacount?: number | null;
  duration?: number | null;
  created_at?: string | null;
  modified_at?: string | null;
  username?: string | null;
  nickname?: string | null;
  flag_visible?: boolean | null;
  flag_visible_online?: boolean | null;
}
/** Summary returned by a bulk collection download (feat 07). */
export interface BulkDownloadSummary {
  downloaded: number;
  skipped: number;
  failed: { kid: string; error: string }[];
}
/** Per-song status event emitted during a bulk collection download (feat 07). */
export interface CollectionDownloadProgress {
  collectionId: string;
  kid: string;
  status: 'start' | 'done' | 'failed';
  completed: number;
  total: number;
  error?: string;
}

/**
 * The only surface the renderer can use. Everything is a narrow, promise-based
 * API over ipcRenderer — no raw Node or Electron access leaks through.
 */
const api = {
  search(params: { query: string; from: number; size: number; mode?: 'text' | 'year' | 'kid' }): Promise<{ count: number; rows: SearchRow[] }> {
    return ipcRenderer.invoke('kara:search', params);
  },
  catalog(): Promise<CatalogEntry[]> {
    return ipcRenderer.invoke('kara:catalog');
  },
  /**
   * Fill in `langs` / `offVocal` for catalog entries downloaded before those
   * fields existed. Resolves with only the entries that were updated (empty
   * array when nothing needed backfilling), so the caller can merge them into
   * the list it already has.
   */
  backfillCatalogMetadata(): Promise<CatalogEntry[]> {
    return ipcRenderer.invoke('kara:catalog-backfill');
  },
  download(kid: string): Promise<CatalogEntry> {
    return ipcRenderer.invoke('kara:download', kid);
  },
  /**
   * Stream a catalog video's bytes from the main process and resolve to an
   * ArrayBuffer. The renderer wraps it in a Blob + object URL (a `blob:` URL,
   * which Electron's default CSP allows) so video.js can play it. This avoids
   * loading file:// URLs directly (blocked for HTTP-origin pages in dev) and
   * custom protocol sources (blocked by the default CSP).
   */
  openMediaStream(kid: string, variant?: 'original' | 'lyricless'): Promise<ArrayBuffer> {
    const channel = 'kara:media-data';
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      ipcRenderer.send('kara:media-stream', kid, variant);

      const onData = (_e: unknown, msg: any): void => {
        if (msg && msg.ok === false) {
          cleanup();
          reject(new Error(msg.error || 'Failed to stream media.'));
          return;
        }
        if (msg && msg.chunk) {
          const u8 = new Uint8Array(msg.chunk);
          chunks.push(u8);
          total += u8.length;
          return;
        }
        if (msg && msg.ok === true) {
          cleanup();
          const buf = new ArrayBuffer(total);
          const view = new Uint8Array(buf);
          let offset = 0;
          for (const c of chunks) {
            view.set(c, offset);
            offset += c.length;
          }
          resolve(buf);
        }
      };
      const cleanup = (): void => {
        ipcRenderer.removeListener(channel, onData);
      };
      ipcRenderer.on(channel, onData);
    });
  },
  delete(kid: string): Promise<boolean> {
    return ipcRenderer.invoke('kara:delete', kid);
  },
  /**
   * Write a lyricless video to the catalog. The renderer performs all DSP
   * (stem separation + re-muxing) and sends the final MP4 bytes here.
   */
  writeLyricless(kid: string, data: ArrayBuffer): Promise<CatalogEntry> {
    return ipcRenderer.invoke('kara:write-lyricless', kid, data);
  },
  /** Check whether a lyricless variant exists for a song. */
  lyriclessStatus(kid: string): Promise<LyriclessStatus> {
    return ipcRenderer.invoke('kara:lyricless-status', kid);
  },
  /** Read the persisted app settings (Config screen). */
  settings(): Promise<AppSettings> {
    return ipcRenderer.invoke('kara:settings');
  },
  /** Persist the separation model chosen on the Config screen. */
  setSeparationModel(model: string): Promise<AppSettings> {
    return ipcRenderer.invoke('kara:set-separation-model', model);
  },
  /** Check whether a model's fp16 artifact is cached locally. */
  modelStatus(model: string): Promise<{ cached: boolean; size?: number }> {
    return ipcRenderer.invoke('kara:model-status', model);
  },
  /** Stream a cached model file to the renderer (returns ArrayBuffer). */
  openModelStream(model: string): Promise<ArrayBuffer> {
    const channel = 'kara:model-data';
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      ipcRenderer.send('kara:model-stream', model);
      const onData = (_e: unknown, msg: any): void => {
        if (msg && msg.ok === false) {
          cleanup();
          reject(new Error(msg.error || 'Failed to stream model.'));
          return;
        }
        if (msg && msg.chunk) {
          const u8 = new Uint8Array(msg.chunk);
          chunks.push(u8);
          total += u8.length;
          return;
        }
        if (msg && msg.ok === true) {
          cleanup();
          const buf = new ArrayBuffer(total);
          const view = new Uint8Array(buf);
          let offset = 0;
          for (const c of chunks) {
            view.set(c, offset);
            offset += c.length;
          }
          resolve(buf);
        }
      };
      const cleanup = (): void => {
        ipcRenderer.removeListener(channel, onData);
      };
      ipcRenderer.on(channel, onData);
    });
  },
  /** Save a model file to disk (called after first download). */
  saveModel(model: string, data: ArrayBuffer): Promise<void> {
    return ipcRenderer.invoke('kara:save-model', model, data);
  },
  onDownloadProgress(callback: (p: DownloadProgress) => void): () => void {
    const listener = (_e: unknown, p: DownloadProgress): void => callback(p);
    ipcRenderer.on('kara:download-progress', listener);
    return () => ipcRenderer.removeListener('kara:download-progress', listener);
  },
  // --- Account (feat 03) -------------------------------------------------
  /** Log in to kara.moe. Returns { username, role } on success. */
  login(params: { username: string; password: string }): Promise<{ username: string; role: string }> {
    return ipcRenderer.invoke('kara:login', params);
  },
  /** Log out (clears the stored session). */
  logout(): Promise<boolean> {
    return ipcRenderer.invoke('kara:logout');
  },
  /** Current login status (never includes the token). */
  accountStatus(): Promise<{ loggedIn: boolean; username?: string; role?: string }> {
    return ipcRenderer.invoke('kara:account-status');
  },
  // --- Collections (feat 04) ---------------------------------------------
  /** List all collections with song counts. */
  collectionsList(): Promise<CollectionRowWithCount[]> {
    return ipcRenderer.invoke('kara:collections-list');
  },
  /** Create a new local collection. */
  collectionCreate(name: string): Promise<CollectionRow> {
    return ipcRenderer.invoke('kara:collection-create', name);
  },
  /** Rename a collection. */
  collectionRename(id: string, name: string): Promise<void> {
    return ipcRenderer.invoke('kara:collection-rename', id, name);
  },
  /** Delete a collection (membership rows cascade; songs are untouched). */
  collectionDelete(id: string): Promise<boolean> {
    return ipcRenderer.invoke('kara:collection-delete', id);
  },
  /** Add a song to a collection. */
  collectionAddSong(collectionId: string, kid: string): Promise<void> {
    return ipcRenderer.invoke('kara:collection-add-song', collectionId, kid);
  },
  /** Remove a song from a collection. */
  collectionRemoveSong(collectionId: string, kid: string): Promise<void> {
    return ipcRenderer.invoke('kara:collection-remove-song', collectionId, kid);
  },
  /** Reorder the songs in a collection (full ordered kid list). */
  collectionReorder(collectionId: string, orderedKids: string[]): Promise<void> {
    return ipcRenderer.invoke('kara:collection-reorder', collectionId, orderedKids);
  },
  /** Get the songs in a collection, ordered by position. */
  collectionSongs(collectionId: string): Promise<CatalogEntry[]> {
    return ipcRenderer.invoke('kara:collection-songs', collectionId);
  },
  /** Get the collections a given song belongs to. */
  collectionsForSong(kid: string): Promise<{ id: string; name: string }[]> {
    return ipcRenderer.invoke('kara:collections-for-song', kid);
  },
  // --- Imported collections ----------------------------------------------
  /**
   * List the logged-in user's kara.moe playlists. Discovery only — writes
   * nothing to the DB. Resolves with [] when logged out.
   */
  playlistsMine(opts?: { filter?: string; order?: PlaylistOrder }): Promise<RemotePlaylist[]> {
    return ipcRenderer.invoke('kara:playlists-mine', opts);
  },
  /**
   * Import a kara.moe playlist as a local, read-only collection: fetches its
   * contents, stores the source plaid plus every song's metadata, and creates
   * the membership rows. Downloads NOTHING. Importing an already-imported
   * playlist syncs it instead of creating a duplicate.
   */
  collectionImport(params: {
    plaid: string;
    name?: string;
    ownerUsername?: string | null;
    origin?: 'own' | 'public';
  }): Promise<CollectionRow> {
    return ipcRenderer.invoke('kara:collection-import', params);
  },
  /**
   * Re-sync an imported collection from its source playlist. On success
   * refreshes metadata + membership and clears the stale flag; on failure
   * (playlist deleted / made private) marks it stale and keeps the local copy.
   */
  collectionSyncImported(
    collectionId: string,
  ): Promise<{ downloadedCount: number; total: number; stale: boolean }> {
    return ipcRenderer.invoke('kara:collection-sync-imported', collectionId);
  },
  /**
   * Download ONE song inside a collection. The song stays a member of the
   * collection (it may have been a metadata-only member before).
   */
  collectionDownloadSong(collectionId: string, kid: string): Promise<CatalogEntry> {
    return ipcRenderer.invoke('kara:collection-download-song', collectionId, kid);
  },
  // --- Bulk collection download (feat 07) --------------------------------
  /**
   * Download every song in a collection that is not already downloaded.
   * Uses the collection's existing membership — it does NOT re-sync from the
   * network (sync is an explicit user action). Reports per-song byte progress
   * on `onDownloadProgress` and per-song status on
   * `onCollectionDownloadProgress`. Individual failures are reported in
   * `failed` and never abort the batch.
   */
  collectionDownload(collectionId: string): Promise<BulkDownloadSummary> {
    return ipcRenderer.invoke('kara:collection-download', collectionId);
  },
  /**
   * Subscribe to per-song bulk-download status events. Returns an unsubscribe
   * function, same pattern as `onDownloadProgress`.
   */
  onCollectionDownloadProgress(callback: (p: CollectionDownloadProgress) => void): () => void {
    const listener = (_e: unknown, p: CollectionDownloadProgress): void => callback(p);
    ipcRenderer.on('kara:collection-download-progress', listener);
    return () => ipcRenderer.removeListener('kara:collection-download-progress', listener);
  },
  // --- Browse another user's public playlists ---
  /**
   * Browse another user's public kara.moe playlists (server-side
   * `byUsername` filter). Pure discovery — no DB writes, no auth required
   * (works logged out). Errors are surfaced to the caller, not swallowed.
   */
  collectionBrowseUser(opts: {
    username: string;
    filter?: string;
    order?: PlaylistOrder;
    includeContributions?: boolean;
    refresh?: boolean;
  }): Promise<RemotePlaylist[]> {
    return ipcRenderer.invoke('kara:collection-browse-user', opts);
  },
};

export type KaraApi = typeof api;

contextBridge.exposeInMainWorld('kara', api);

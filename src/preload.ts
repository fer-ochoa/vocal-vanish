import { contextBridge, ipcRenderer } from 'electron';

// Types shared with the main process (kept in sync with src/index.ts).
export interface SearchRow {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  size: number | null;
}

export interface CatalogEntry {
  kid: string;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  file: string;
  size: number | null;
  downloadedAt: string;
  lyriclessFile?: string | null;
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
  /** Check whether the htdemucs model is cached locally. */
  modelStatus(): Promise<{ cached: boolean; size?: number }> {
    return ipcRenderer.invoke('kara:model-status');
  },
  /** Stream the cached model file to the renderer (returns ArrayBuffer). */
  openModelStream(): Promise<ArrayBuffer> {
    const channel = 'kara:model-data';
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      ipcRenderer.send('kara:model-stream');
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
  /** Save the model file to disk (called after first download). */
  saveModel(data: ArrayBuffer): Promise<void> {
    return ipcRenderer.invoke('kara:save-model', data);
  },
  onDownloadProgress(callback: (p: DownloadProgress) => void): () => void {
    const listener = (_e: unknown, p: DownloadProgress): void => callback(p);
    ipcRenderer.on('kara:download-progress', listener);
    return () => ipcRenderer.removeListener('kara:download-progress', listener);
  },
};

export type KaraApi = typeof api;

contextBridge.exposeInMainWorld('kara', api);

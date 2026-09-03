# vocal-vanish — Implementation Notes

This document is a complete, self-contained description of how this project is built. It is written so that **another AI model can read it and continue working on the project** without having to re-derive the design from scratch. Read the [README](../README.md) for the user-facing summary; this file is the technical reference.

---

## 1. What the app does

A desktop client for the **Kara moe API** (anime karaoke videos with hardcoded subtitles). Four screens:

1. **Search** — query the Kara moe database, show paginated results, download a song's hardsubbed video.
2. **Catalog** — list locally downloaded songs (title, series, singer, duration), filter, play, delete, generate lyricless versions.
3. **Player** — play a downloaded video with video.js (subtitles are burned in, so no separate track is needed); Original / Lyricless tabs.
4. **Config** — pick the stem-separation model used by *Lyricless* and show whether processing runs on WebGPU or the CPU WASM fallback.

The app is a **proof of concept**: simple, minimal UI, no auth. The only persisted settings are in `userData/settings.json` (currently just the selected separation model).

---

## 2. Tech stack and tooling

| Concern    | Choice                                                        |
|------------|---------------------------------------------------------------|
| Shell      | Electron, scaffolded with **Electron Forge** (`@electron-forge/cli` ^7) |
| Bundler    | Webpack via `@electron-forge/plugin-webpack` (separate configs for main + renderer) |
| UI         | **Vue 3.5** (Composition API, `<script setup lang="ts">`)      |
| Routing    | **Vue Router 4** with `createWebHashHistory`                  |
| Video      | **video.js 8** (`import videojs from 'video.js'` + its CSS)   |
| Language   | TypeScript (~4.5), compiled by `ts-loader` (transpileOnly) + `fork-ts-checker-webpack-plugin` for type-checking |
| HTTP       | Node's built-in `https` module only — **no** axios/node-fetch in the main process |

Key versions live in `package.json`. Notable additions on top of the default Forge scaffold:
- `vue`, `vue-router`, `video.js` (runtime deps)
- `vue-loader@^16` (dev dep — see §8 for why v16 and not v17)

### Build entry points (defined in `forge.config.ts`)
- **Main** entry: `./src/index.ts` → `webpack.main.config.ts`
- **Renderer** entry: `./src/renderer.ts` + HTML `./src/index.html`, preload `./src/preload.ts` → `webpack.renderer.config.ts`

---

## 3. Process architecture (Electron best practices)

The app follows the standard three-process split with a strict security boundary:

```
┌────────────────────────┐   IPC (invoke/handle, send/on)   ┌──────────────────────────┐
│  MAIN process          │◄───────────────────────────────►│  RENDERER (Vue app)      │
│  src/index.ts          │                                  │  src/renderer.ts + .vue  │
│  • Kara moe API client │        via window.kara           │  • Search / Catalog /    │
│  • Filesystem/catalog  │   (exposed by preload bridge)    │    Player screens        │
│  • Download + stream   │                                  │  • video.js player       │
└────────────────────────┘                                  └──────────────────────────┘
        ▲                                                        ▲
        │  https://kara.moe                                      │  blob: media URLs
```

- **Renderer has no Node access.** `BrowserWindow` is created with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` (see `createWindow()` in `src/index.ts`).
- **All privileged work happens in the main process**: network calls, file I/O, downloads. The renderer only talks to a narrow, promise-based API exposed on `window.kara`.
- **The bridge** is `src/preload.ts`, which uses `contextBridge.exposeInMainWorld('kara', api)`.

> Rule of thumb for extending: if a feature needs the network or the filesystem, add an IPC handler in `src/index.ts` and a matching method in `src/preload.ts`; never import Node modules into a `.vue` file.

---

## 4. Kara moe API — endpoints actually used

Base URL: **`https://kara.moe/api`** (media files live under `https://kara.moe`). Only this API is used.

### Search
```
GET https://kara.moe/api/karas/search?filter=<text>&from=<offset>&size=<limit>
```
- `filter` — plain text; matches title / series / singer (this is the default "text" criterion).
- `q` — structured filters, e.g. `y:2019` (year), `k:<kid>` (specific song KID), `t:<tid>` (tag). Multiple criteria separated by `!`.
- `from` / `size` — pagination (offset / page size).

**Response shape:**
```jsonc
{
  "infos":   { "count": 355, "from": 0, "to": 2 },   // count = total matches
  "i18n":    { ... },
  "avatars": { ... },
  "content": [ /* Song[] */ ]
}
```

### Song detail
```
GET https://kara.moe/api/karas/{kid}
```
Returns a single `Song` (same fields as a search `content` item).

**Key `Song` fields used by the app:**
| Field | Meaning |
|-------|---------|
| `kid` | Unique song id (UUID) — used everywhere as the primary key |
| `titles` | `{ [lang]: string }` — localized titles |
| `titles_default_language` | Which language in `titles` to prefer |
| `songname` | Fallback human-readable name |
| `duration` | Duration in **seconds** |
| `mediasize` | Video size in **bytes** |
| `series[]`, `singers[]`, `songtypes[]`, `langs[]` | Tag arrays (`{ tid, name, ... }`) |
| `hardsubbed_mediafile` | **Filename of the hardsub `.mp4`** — this is what we download and play |

### Hardsub video
The hardsub file is served directly at:
```
GET https://kara.moe/hardsubs/<hardsubbed_mediafile>
```
(e.g. `https://kara.moe/hardsubs/30347a72-....mp4`). It returns `video/mp4` with a `content-length` header, so download progress can be computed. There is also `GET /api/karas/{kid}/hardsub`, which 301-redirects to the same file — but the app downloads from the direct `/hardsubs/` URL using the filename from `hardsubbed_mediafile`.

> The `song.hardsubbed_mediafile` value **is** the exact filename to request under `/hardsubs/` and to save locally.

---

## 5. Main process (`src/index.ts`)

This file owns everything privileged. Major sections:

### Types
- `Song`, `SearchResponse`, `CatalogEntry`, `SearchRow`, `TagRef`, `LyricsInfo` — see the file for full definitions. `SearchRow` is the flattened shape shown in search results; `CatalogEntry` is what's persisted per downloaded song.

### Catalog storage
- **Directory:** `path.join(app.getPath('userData'), 'kara-catalog')`. On Linux that's `~/.config/vocal-vanish/kara-catalog/`.
- **Index file:** `catalog.json` in that directory — a `Record<kid, CatalogEntry>`.
- Helpers: `ensureCatalogDir()`, `readIndex()`, `writeIndex(index)`, `songToRow(song)`.
- Video files are saved into the same directory as `<kid>.<size>.<hash>.mp4` (the `hardsubbed_mediafile` name).

### HTTP helpers
- `httpGetJson<T>(url)` — GET a JSON endpoint using `https.get`; follows **one** redirect; rejects on 4xx/5xx.
- `downloadFile(url, destPath, onProgress)` — streams a file to disk via `res.pipe(fs.createWriteStream)`, following redirects, calling `onProgress(receivedBytes, totalBytes|null)` per chunk (total from `content-length`). Resolves with final byte count.

### IPC handlers (`registerIpc()`)
| Channel | Kind | Purpose |
|---------|------|---------|
| `kara:search` | `handle` (invoke) | Params `{ query, from, size, mode? }`. `mode`: `text`→`filter`, `year`→`q=y:`, `kid`→`q=k:`. Returns `{ count, rows: SearchRow[] }`. |
| `kara:catalog` | `handle` | Returns all `CatalogEntry[]`, sorted by `downloadedAt` desc. |
| `kara:download` | `handle` | Params `kid`. Fetches song detail, downloads `hardsubbed_mediafile` to `<dir>/<name>.mp4` (via a `.part` temp file, then atomic `rename`), sends `kara:download-progress` events during transfer, writes the catalog index, returns the new `CatalogEntry`. |
| `kara:media-stream` | `on` (send) | Params `kid`, optional `variant` (`'lyricless'`). Pipes the local video file to the renderer as `kara:media-data` messages (see §6). |
| `kara:delete` | `handle` | Params `kid`. Deletes the video file + lyricless variant + index entry. |
| `kara:write-lyricless` | `handle` | Params `kid`, `ArrayBuffer`. Atomic write of `<kid>.lyricless.mp4` + index update (see docs/lyricless-implementation.md). |
| `kara:lyricless-status` | `handle` | Params `kid` → `{ exists, file? }`. |
| `kara:model-status` | `handle` | Params optional `modelId` → `{ cached, size? }` for `<modelId>_fp16.onnx` in userData. |
| `kara:model-stream` | `on` (send) | Params optional `modelId`. Streams the cached model file as `kara:model-data` chunks. |
| `kara:save-model` | `handle` | Params `modelId`, `ArrayBuffer`. Writes `<modelId>_fp16.onnx` to userData. |
| `kara:settings-get` / `kara:settings-set` | `handle` | Read/merge-patch `settings.json` in userData (currently holds `separationModel`). |

**Download progress events:** main sends `sender.send('kara:download-progress', { kid, received, total })` as bytes arrive; the renderer listens and updates the overlay.

### CSP (`applyCsp()`)
Set on `session.defaultSession.webRequest.onHeadersReceived` at `app.on('ready')`. This is **critical** for video playback — see §7.

```
default-src 'self'
script-src 'self' [dev: + 'unsafe-inline' 'unsafe-eval']   // dev-only relaxation (webpack HMR)
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
media-src 'self' blob: file:      ← allows the blob: media URLs
font-src 'self' data:
connect-src 'self' https://kara.moe
```
`isDev = !app.isPackaged`. In production `script-src` stays strictly `'self'`.

### Window (`createWindow()`)
1080×720, min 760×480, dark background. `webPreferences`: `preload`, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`. Loads `MAIN_WINDOW_WEBPACK_ENTRY`.

Startup order in `app.on('ready')`: `applyCsp()` → `registerIpc()` → `createWindow()`.

---

## 6. Preload bridge (`src/preload.ts`)

Exposes `window.kara` with these methods (the **complete** renderer API surface):

| Method | Returns | Notes |
|--------|---------|-------|
| `search({query, from, size, mode?})` | `Promise<{count, rows: SearchRow[]}>` | invoke `kara:search` |
| `catalog()` | `Promise<CatalogEntry[]>` | invoke `kara:catalog` |
| `download(kid)` | `Promise<CatalogEntry>` | invoke `kara:download` (resolves when fully downloaded) |
| `openMediaStream(kid, variant?)` | `Promise<ArrayBuffer>` | **see below** |
| `delete(kid)` | `Promise<boolean>` | invoke `kara:delete` |
| `writeLyricless(kid, buf)` | `Promise<CatalogEntry>` | invoke `kara:write-lyricless` |
| `lyriclessStatus(kid)` | `Promise<{exists, file?}>` | invoke `kara:lyricless-status` |
| `modelStatus(modelId?)` / `openModelStream(modelId?)` / `saveModel(modelId, buf)` | — | per-model ONNX cache (see docs/lyricless-implementation.md) |
| `getSettings()` / `setSettings(patch)` | `Promise<{separationModel?}>` | read/merge-patch `settings.json` |
| `onDownloadProgress(cb)` | `() => void` (unsubscribe) | listens to `kara:download-progress` |

### How video playback works (the important part)
The renderer **cannot** load a `file://` URL for the `<video>` element in dev mode (the page is served from the webpack-dev-server HTTP origin, which is not allowed to fetch local files), and Electron's default CSP blocks both `file:` and `blob:` media. So:

1. Renderer calls `window.kara.openMediaStream(kid)`.
2. Preload sends `kara:media-stream` (with `kid`) to main.
3. Main opens the local file with `fs.createReadStream` and pipes chunks back as `kara:media-data` messages: `{ chunk }` per chunk, then a terminal `{ ok: true }` (or `{ ok:false, error }`).
4. Preload reassembles the chunks into a single `ArrayBuffer` and resolves the promise.
5. The renderer wraps it in `new Blob([buf], {type:'video/mp4'})`, creates an object URL (`blob:...`), and hands that to video.js.

The `blob:` URL is permitted by our CSP (`media-src ... blob: file:`), so playback works in **both** dev and production. The Player view revokes the object URL on unmount to avoid a memory leak.

> If you change how media is delivered, keep both constraints in mind: (a) no direct `file://` loads from an HTTP-origin page, and (b) the CSP must allow whatever scheme the `<video>` src uses.

---

## 7. Content Security Policy — why it's a thing here

This was the trickiest part to get right. Two separate problems both manifested as a **black screen / "media could not be loaded"**:

1. **Dev-mode HMR:** webpack-dev-server's client evaluates code via `eval`. A CSP without `'unsafe-eval'` in `script-src` blocks it → black screen. Fix: relax `script-src` to include `'unsafe-inline' 'unsafe-eval'` **only when `!app.isPackaged`**.
2. **Video media:** Electron's *default* CSP (`default-src 'self' 'unsafe-inline' data:`) does not allow `blob:` or `file:` for media → the `<video>` src is blocked before video.js even runs. Fix: set an explicit CSP via `onHeadersReceived` that includes `media-src 'self' blob: file:`.

Both are handled in `applyCsp()`. **Do not** put a CSP `<meta>` tag in `index.html` — it would block dev HMR again. The session-level header is the single source of truth.

---

## 8. Renderer (Vue)

### Entry and routing
- `src/renderer.ts` — `createApp(App).use(router).mount('#app')`, imports `./styles.css`.
- `src/router.ts` — hash history, four routes:
  - `/` → `SearchView`
  - `/catalog` → `CatalogView`
  - `/player/:kid` → `PlayerView` (props: true)
  - `/config` → `ConfigView`

### Components
- **`src/App.vue`** — shell: fixed left sidebar (brand + nav links to Search/Catalog/Config) and a `<router-view>` content area.
- **`src/views/SearchView.vue`** — search bar (input + criteria `<select>`), paginated result list, per-row *Download* button, full-screen download progress overlay, error toast. Page size = 25. Criteria map to `mode`: `text`/`year`/`kid`.
- **`src/views/CatalogView.vue`** — local filter input + list of catalog entries (title, series, singer, duration) with *Play* (routes to player), *Lyricless* and delete buttons.
- **`src/views/PlayerView.vue`** — resolves the entry's title from `catalog()`, calls `openMediaStream(kid)` → Blob → object URL → video.js. Disposes the player and revokes the URL on unmount.
- **`src/views/ConfigView.vue`** — separation-model dropdown (persisted via `getSettings`/`setSettings`) + WebGPU/WASM backend badge from a renderer-side `navigator.gpu` probe.

### Styling
- `src/styles.css` — plain CSS, dark theme via CSS variables (`--bg`, `--panel`, `--accent`, ...). No UI framework; keep it minimal.
- `src/index.html` — minimal: `<div id="app">`, **no CSP meta tag** (see §7).

### Type shims
- `src/shims-vue.d.ts` — declares `*.vue` modules and a loose `vue-router` module (the project's tsconfig doesn't resolve vue-router's bundled types). 
- `src/global.d.ts` — augments `Window` with `kara: KaraApi` (imported type from `preload.ts`).

---

## 9. Webpack configuration quirks (read before touching the build)

These are non-obvious and will bite you if changed carelessly.

### vue-loader must be loaded via `createRequire` + `Reflect.construct`
In `webpack.renderer.config.ts`, the Vue plugin is **not** imported normally:
```ts
import { createRequire } from 'module';
const cjsRequire = createRequire(__filename);
const VueLoaderPluginCtor: any = cjsRequire('vue-loader/dist/plugin').default;
const VueLoaderPlugin: any = Reflect.construct(VueLoaderPluginCtor, []);
```
**Why:** Electron Forge loads `forge.config.ts` (and the configs it imports) through **jiti**, whose ESM interop breaks `new` on required class exports with `TypeError: Class constructor ... cannot be invoked without 'new'`. A normal `import { VueLoaderPlugin } from 'vue-loader'` fails at config-load time. Loading the internal `vue-loader/dist/plugin` default export through a real CJS require and instantiating with `Reflect.construct` sidesteps the bug. **Keep this pattern** if you edit the renderer webpack config.

### vue-loader version is pinned to ^16
v17's named `VueLoaderPlugin` export is mis-wired in some builds (aliases the loader function, not the class). v16 (`^16.8.3`) works with the pattern above. Don't upgrade to v17 without re-testing the config load.

### Asset rules for video.js
`webpack.renderer.config.ts` adds `asset/resource` rules so video.js's fonts (`.woff2/.ttf/.eot`) and images emit as static files (`fonts/`, `img/`). The renderer also resolves `.vue` extensions and aliases `vue$` → `vue/dist/vue.esm-bundler.js`.

### CSS
`webpack.rules.ts` handles `.vue` via `vue-loader`; `webpack.renderer.config.ts` adds `style-loader`+`css-loader` for `.css`.

---

## 10. File layout

```
vocal-vanish/
├─ package.json              # scripts + deps (see §2)
├─ forge.config.ts           # Forge config: makers, WebpackPlugin entries, fuses
├─ webpack.main.config.ts    # main-process webpack (entry src/index.ts)
├─ webpack.renderer.config.ts# renderer webpack (vue-loader quirk, asset rules)
├─ webpack.rules.ts          # shared rules (.vue, native modules, ts)
├─ webpack.plugins.ts        # shared plugins
├─ tsconfig.json
├─ src/
│  ├─ index.ts               # MAIN process: API client, catalog, IPC, CSP, window
│  ├─ preload.ts             # contextBridge → window.kara
│  ├─ renderer.ts            # Vue app bootstrap
│  ├─ router.ts              # routes (hash history)
│  ├─ App.vue                # shell (sidebar + router-view)
│  ├─ index.html             # minimal, NO CSP meta tag
│  ├─ styles.css             # dark theme, plain CSS
│  ├─ shims-vue.d.ts         # *.vue + vue-router type shims
│  ├─ global.d.ts            # window.kara typing
│  ├─ lyricless/
│  │  ├─ pipeline.ts         # decode → separate → re-mux orchestration
│  │  ├─ stems.ts            # audio decode/resample, unblend separation + mixing
│  │  └─ models.ts           # separation-model catalog (Config dropdown data)
│  └─ views/
│     ├─ SearchView.vue      # search + download
│     ├─ CatalogView.vue     # local catalog list + lyricless button
│     ├─ PlayerView.vue      # video.js player, Original/Lyricless tabs
│     └─ ConfigView.vue      # model picker + WebGPU/WASM status
├─ docs/implementation.md    # this file
└─ README.md
```

---

## 11. Running and building

```bash
npm install
npm start          # dev (webpack-dev-server + Electron, hot reload)
npm run lint       # eslint
npm run package    # bundle for current platform (no installer)
npm run make       # build installers (squirrel/zip/rpm/deb per forge.config.ts)
```

### Environment-specific gotchas (from the original dev sandbox)
These are **not** part of the app logic but were needed to run in a restricted environment; a normal machine with network + writable `~/.cache` won't hit them:
- **npm cache:** if `~/.npm` is read-only, install with a local cache: `npm install --cache ./.npm-cache`.
- **Electron binary:** if Electron can't download to `~/.cache/electron`, you can copy an existing `node_modules/electron/dist` in place and set `node_modules/electron/path.txt` to contain exactly `electron` (no trailing newline). The project declares Electron 44; a nearby 43.x binary works for dev.
- **Port 9000:** Forge's web-multi-logger uses port 9000; if you see `EADDRINUSE`, kill the stale `electron-forge start` process.

---

## 12. Ideas for extending (not yet implemented)

- **Cancel download** — add an IPC to abort the in-flight `https` request / close the write stream, and a *Cancel* button in the overlay.
- **Resume/interrupted downloads** — the `.part` file is currently discarded on the next attempt; could support byte-range resume (`Range` header) since the server supports it.
- **Cover art** — search results can carry avatar/cover data (`avatars` in the response); not currently displayed.
- **Settings** — choose catalog directory, page size, default language for titles.
- **Multiple languages** — `titles` is a map; UI could let the user pick which language to display.
- **Playback features** — loop, karaoke offset/timing, volume persistence (video.js supports most of these).
- **Testing** — no test suite yet; Vitest for renderer logic + a small mock of the Kara moe API would help.

### Conventions to follow when extending
1. New network/FS work → main process IPC handler (`src/index.ts`) + preload method (`src/preload.ts`). Never Node in `.vue`.
2. Keep the CSP in `applyCsp()` as the single source of truth; if you add a new media scheme, update `media-src` there.
3. Persisted data lives under `userData/kara-catalog`; keep `catalog.json` the index and videos alongside it.
4. Preserve the vue-loader loading pattern in `webpack.renderer.config.ts` (§9).
5. Keep the UI minimal (plain CSS, no framework) to match the PoC scope.

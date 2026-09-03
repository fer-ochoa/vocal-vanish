# Lyricless Processing — Implementation Plan

Plan for adding in-app **lyricless video generation** to vocal-vanish: a per-row *Lyricless* button in the Catalog, a progress overlay (same style as the download one), and an **Original / Lyricless** tabbed player. All processing happens inside the Electron app using npm packages only — no Python, no ffmpeg binaries.

> Status: **implemented.** See `src/lyricless/` for the pipeline, `src/views/CatalogView.vue` for the button + overlay, and `src/views/PlayerView.vue` for the tabbed player.
> Prerequisite docs: [README](../README.md) (user-facing overview), [implementation.md](./implementation.md) (current architecture — read §3 process split, §6 preload bridge, §7 CSP before starting).

---

## 1. Goal and success criteria

Turn a downloaded hardsubbed karaoke video into a **lyric-less** version by removing the vocal stem from its audio, while keeping the original video file untouched.

Done when:

1. Every row in the Catalog screen has a *Lyricless* button (in addition to *Play* and delete).
2. Clicking it shows a full-screen progress overlay (same `.overlay`/`.bar` pattern as the download overlay) with stage labels and a percentage, updating live.
3. The pipeline runs entirely inside the app: extract audio → stem separation → recombine all stems except vocals → mux original video + new audio into a **new** file (`<kid>.lyricless.mp4`). The original `.mp4` is never modified or copied in place.
4. The Player screen shows two tabs — **Original** and **Lyricless**. *Original* plays the existing video; *Lyricless* plays the processed file when it exists, otherwise an inline message ("Not generated yet") with a button that triggers the same processing flow.
5. `catalog.json` records the lyricless file per entry, so state survives restarts; deleting a song removes both files.
6. No Python, no ffmpeg/ffprobe binaries anywhere in the dependency tree.

---

## 2. Research findings (why things are where they are)

### 2.1 unblend (stem separation) — [Ryan5453/unblend](https://github.com/Ryan5453/unblend/blob/main/web/unblend/README.md)

- **Not published on npm.** `npm view unblend` → 404. The library lives in the repo at `web/unblend` (workspaces layout; root `package.json` is a private workspace file). It must be installed from git:
  ```bash
  npm install github:Ryan5453/unblend#web/unblend   # or a pinned commit/tag for reproducibility
  ```
  Pin to a **specific commit SHA** in `package.json` (e.g. `github:Ryan5453/unblend@<sha>`) so builds are reproducible; the API is at v1.0.0 and young.
- ESM-only (`"type": "module"`), zero peer deps; bundles `onnxruntime-web@1.26.0` and `fft.js`. Workers are created with `new Worker(new URL('./workers/*.js', import.meta.url))` — **requires a bundler that resolves that pattern** (webpack 5 does, but see §7 for the asset-relocator trap).
- API surface (from its README + source):
  ```ts
  import { Separator } from 'unblend';
  const sep = await Separator.load('htdemucs', { backend: 'webgpu' | 'wasm', precision: 'fp16' });
  const result = await sep.separate(audioBuffer /* AudioBuffer @44.1kHz, 1–2ch */, { onProgress: p => p.fraction });
  // result.stems: Record<string, Float32Array> — interleaved [L0,R0,L1,R1,...], always 2 channels
  await sep.unload();
  ```
- **Input contract:** exactly **44.1 kHz**, 1 or 2 channels (mono duplicated internally). Output is always stereo per stem.
- Models: `htdemucs` (drums/bass/other/vocals, ~91 MB fp16), `htdemucs_6s`, `bs_roformer_sw` (WebGPU-only, ~364 MB fp16), `melband_roformer_kim` (vocals + "other" = mixture − vocals), `scnet_small`, `scnet_xl_wide_v5`. **Default: `htdemucs` @ fp16** — good quality/size/speed balance and runs on the WASM fallback.
- Weights are fetched at runtime from Hugging Face (`https://huggingface.co/Ryan5453/unblend/resolve/<rev>/<model>_<precision>.onnx`) with real download progress via `LoadModelOptions.onProgress`. The app should **cache the ONNX file** under `userData` (see §6) so only the first run pays the ~91 MB download.
- WASM multithreading requires a cross-origin-isolated page (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`). Without COOP/COE, ORT runs single-threaded — acceptable but slower; see §7.3 for the decision.
- Aborting a separation **invalidates the instance** — load a fresh one to retry (design the worker lifecycle accordingly).

### 2.2 mediabunny (audio/video manipulation) — [mediabunny.dev](https://mediabunny.dev/)

- On npm: `mediabunny@1.55.5`, pure TypeScript, **zero dependencies**, tree-shakable, MPL-2.0.
- Core idea: `Input` (source + formats) → `Conversion.init({ input, output, ... })` → `execute()`. Video tracks can be **packet-copied** when codecs match the container (no re-encode); audio can be replaced via **composable conversions** (`composable: true`) with an external `AudioBufferSource` / `AudioSampleSource`.
- Progress: `conversion.onProgress = (p: 0..1) => ...` set before `execute()`.
- **Critical constraint:** decoding/encoding uses the **WebCodecs API + OffscreenCanvas**, which only exist in a *browser* context. The Electron **main process has no WebCodecs**. Two options:
  - (a) run mediabunny in the **renderer** — it works out of the box;
  - (b) run it in the **main process** via `@mediabunny/server` (pulls in the native `node-av` package, i.e. FFmpeg's libav* compiled to a Node addon).
- **Decision: option (a) — renderer.** Rationale: no native module (keeps Forge packaging simple and cross-platform), unblend *must* run in the renderer anyway (WebGPU/`AudioContext`/workers), so audio extraction, separation, recombination and muxing can all live in one place. The main process keeps doing what it's good at: file I/O, catalog index, progress relay.
  - `@mediabunny/server` is recorded as a fallback if renderer-side memory becomes a problem (see §8 risks).

### 2.3 Where the pipeline can run (process placement)

| Step | API needed | Runs in |
|---|---|---|
| Read video file bytes | `fs` | **main** (stream to renderer, like existing `kara:media-stream`) |
| Demux / extract audio samples | WebCodecs (`AudioDecoder`) | **renderer** (mediabunny) |
| Resample to 44.1 kHz | Web Audio | **renderer** (`OfflineAudioContext`) |
| Stem separation | ONNX workers, WebGPU/WASM | **renderer** (unblend) |
| Recombine stems (sum all except vocals) | plain Float32 math | **renderer** |
| Mux video (packet-copy) + new AAC audio → MP4 | WebCodecs (`AudioEncoder`), mediabunny | **renderer** |
| Write final file, update `catalog.json` | `fs` | **main** (write via `.part` + atomic rename) |

### 2.4 Current app constraints that shape the design

- CSP in `src/index.ts` (`applyCsp()`): `connect-src 'self' https://kara.moe` — must be extended for Hugging Face weight downloads (§7.2).
- Renderer is sandboxed (`sandbox: true`, no Node) — all FS work stays behind the preload bridge.
- Media delivery to `<video>` goes through IPC chunking → `Blob` → `blob:` URL (works in dev + prod; keep this pattern for the lyricless file too).
- Webpack quirks (§9 of implementation.md): main and renderer are separate webpack builds; the renderer build already has asset rules for video.js fonts/images.

---

## 3. Architecture overview

```
Renderer (new: src/lyricless/*)                 Main process (src/index.ts)
─────────────────────────────────────           ────────────────────────────
LyriclessPipeline (mediabunny + unblend)
  1. bytes = kara.openMediaStream(kid)
  2. Input(BlobSource) → extract audio @44.1k
  3. Separator.load('htdemucs', fp16)
       └─ onProgress ───────────────► IPC 'kara:lyricless-progress'
  4. separate() → stems                    Main relays to renderer UI:
  5. instrumental = drums+bass+other        kara:lyricless-progress {kid, stage, fraction}
  6. composable Conversion:
       video: packet-copy (no re-encode)
       audio: AudioBufferSource(AAC ~192k)
  7. output bytes ───────────────────► kara.writeLyricless(kid, ArrayBuffer)
                                          → <kid>.lyricless.mp4 (.part + rename)
                                          → catalog.json entry updated
```

- **Single-flight:** one pipeline at a time (main keeps `activeLyriclessKid`; renderer disables buttons while busy).
- **Idempotent:** if `<kid>.lyricless.mp4` exists and is non-empty, the button shows "Reprocess" (regenerates over it); the player's Lyricless tab just plays it.
- **Model cache:** ONNX weights cached in `userData/kara-catalog/models/` via a small main-side fetch helper (`kara:model-cache`, reusing the existing `downloadFile` with progress), passed to unblend through `LoadModelOptions.modelUrl` (file:// is not loadable from an HTTP-origin page in dev, so the worker must receive bytes another way — see §5.3; if that proves awkward, fall back to direct HF fetch with caching via `CacheStorage`).

---

## 4. File and data changes

### 4.1 New files

| File | Purpose |
|---|---|
| `src/lyricless/pipeline.ts` | Orchestrates the whole pipeline in the renderer: mediabunny extract → unblend separate → recombine → composable mux. Emits progress via a callback. Pure functions + one `runLyricless(kid, onProgress): Promise<ArrayBuffer>` entry point. |
| `src/lyricless/stems.ts` | Float32 math helpers: deinterleave/interleave, sum stems (all except `vocals`) with soft clipping to [-1, 1], build an `AudioBuffer` at 44.1 kHz from interleaved stem arrays. Unit-testable without DOM audio. |
| `src/views/CatalogView.vue` *(modified)* | *Lyricless* button per row + processing overlay (see §5). |
| `src/views/PlayerView.vue` *(modified)* | Original / Lyricless tabs (see §5). |

### 4.2 Modified files

| File | Change |
|---|---|
| `package.json` | Add deps: `mediabunny@^1.55.5`, `unblend` (git, pinned SHA), and `onnxruntime-web@1.26.0` **hoisted explicitly** so the renderer webpack build resolves ORT's `.wasm`/worker assets from one location (§7). |
| `src/index.ts` | New IPC: `kara:lyricless-progress` relay (main→renderer send), `kara:write-lyricless` (handle: kid + ArrayBuffer → file write + index update), `kara:model-cache` (handle: fetch+cache ONNX bytes with progress events), `kara:lyricless-status` (handle: kid → `{ exists, size }` for button state). Extend CSP (§7.2). `kara:delete` also unlinks the lyricless file. |
| `src/preload.ts` | New methods: `writeLyricless(kid, buf)`, `lyriclessStatus(kid)`, `onLyriclessProgress(cb)`, `modelCache(name)` (or equivalent), and extend `CatalogEntry` with `lyriclessFile?: string | null`. Keep the bridge narrow — no Node leaks. |
| `src/global.d.ts` | Pick up the new `KaraApi` surface automatically (type is imported from preload). |
| `src/styles.css` | `.tabs`, `.tab`, `.tab-active`, small "processing" spinner/label tweaks; reuse existing `.overlay`/`.bar`/`.toast` classes unchanged. |
| `webpack.renderer.config.ts` | Asset rules for unblend's worker files + ORT `.wasm` (§7.1). Keep the vue-loader `createRequire` pattern untouched. |

### 4.3 `catalog.json` schema change (backward compatible)

```jsonc
{
  "<kid>": {
    "kid": "...", "title": "...", "series": "...", "singer": "...",
    "duration": 210, "file": "<kid>.<size>.<hash>.mp4", "size": 123456789,
    "downloadedAt": "2026-01-01T00:00:00.000Z",
    "lyriclessFile": "<kid>.lyricless.mp4"   // NEW — null/absent until generated
  }
}
```

- Old indexes without the field keep working (`entry.lyriclessFile ?? null`).
- Lyricless file name is deterministic: `<kid>.lyricless.mp4` (kid is already in `file`, so no ambiguity).
- `kara:delete` removes both files.

---

## 5. UI changes

### 5.1 Catalog screen (`src/views/CatalogView.vue`)

- Row actions become: **Play** | **Lyricless** (or ✓/↻ if already generated) | ✕ delete.
  - Button label logic: `entry.lyriclessFile` → "Reprocess" (ghost style); else "Lyricless". Disabled while any pipeline is running (single-flight).
- On click → `startLyricless(kid, title)`:
  1. Show the existing overlay pattern (`downloading`-style state renamed to a generic `busy`): dialog titled **"Generating lyricless version…"**, song title, stage label line, progress bar + percent.
  2. Subscribe `window.kara.onLyriclessProgress` (same shape as download progress: `{ kid, stage, fraction }`).
  3. Call the pipeline (see §5.3); on success refresh `catalog()`; on error show the toast and keep the overlay hidden.
- Stage labels shown to the user (mapped from progress events):
  - `loading-model` — "Loading separation model… (first run downloads ~91 MB)"
  - `extracting-audio` — "Extracting audio…"
  - `separating` — "Removing vocals…" (the long step; fraction from unblend)
  - `muxing` — "Rebuilding video…"
- The overlay is **not** a hard block on navigation (matches download behavior: it's an overlay, not a route guard).

### 5.2 Player screen (`src/views/PlayerView.vue`)

- Two tabs above the video: **Original** | **Lyricless**.
  - `lyriclessFile` present → both tabs active; default to *Original*.
  - Not present → *Lyricless* tab renders a muted placeholder panel with "This song has no lyricless version yet." + a **Generate** button that runs the same pipeline flow (overlay reuses the catalog one, or an inline bar — keep it inline in the player for locality).
- Implementation: **one video.js instance**, swap `player.src({ src: blobUrl, type: 'video/mp4' })` on tab change. Keep only the active tab's Blob in memory; revoke the other object URL on switch/unmount (both URLs are created lazily — don't stream both files up front).
- Tab styling: minimal `.tabs` row matching the dark theme (plain CSS, no framework — per project convention).

### 5.3 Shared pipeline trigger (renderer)

```ts
// src/lyricless/pipeline.ts (sketch)
export interface LyriclessProgress { kid: string; stage: Stage; fraction: number } // 0..1 within stage
export async function runLyricless(kid: string, onProgress: (p: LyriclessProgress) => void): Promise<ArrayBuffer> {
  const bytes = await window.kara.openMediaStream(kid);            // existing IPC
  const audio44k = await extractAudio44100(bytes, onProgress);     // mediabunny + OfflineAudioContext
  const sep = await loadSeparator(onProgress);                     // unblend, model cache
  try {
    const { stems } = await sep.separate(audio44k, { onProgress: p => onProgress({ kid, stage: 'separating', fraction: p.fraction }) });
    const instrumental = mixStemsExcluding(stems, 'vocals');       // Float32 math
    return muxVideoWithAudio(bytes, instrumental, onProgress);     // mediabunny composable conversion
  } finally { sep.unload(); }
}
```

The renderer sends progress events to main (`kara:lyricless-progress`) purely so the overlay can live in either view; simpler alternative (chosen): **the view that started the pipeline keeps its own listener** — no main relay needed at all. Progress callback is passed directly into `runLyricless`. *(Main-side relay only if we later want cross-window progress.)*

---

## 6. Main-process changes (`src/index.ts`)

1. **`kara:write-lyricless`** (handle): params `{ kid, data: ArrayBuffer }`.
   - Resolve entry; write `<dir>/<kid>.lyricless.mp4.part`, `fs.renameSync` → final name (atomic, mirrors download).
   - Update index: `entry.lyriclessFile = '<kid>.lyricless.mp4'`; `writeIndex`.
   - Reject if entry missing or file already in progress.
2. **`kara:lyricless-status`** (handle): params `kid` → `{ exists: boolean, size: number | null }` (cheap `statSync`, drives button label on catalog load).
3. **`kara:model-cache`** (handle): params `{ name: 'htdemucs_fp16' }` → checks `<catalogDir>/models/<name>.onnx`; if absent, downloads from the HF URL (same immutable revision unblend uses — keep the URL/size/sha in one constant table copied from unblend's `model-artifacts.ts`) via existing `downloadFile`, sending `kara:model-progress` events; returns `{ url: <file path>, size }`.
   - **How the worker gets the bytes:** unblend's ONNX worker fetches `modelUrl` itself. A `file://` URL is not reachable from a sandboxed renderer page (dev HTTP origin), so the pragmatic v1 approach: skip main-side caching and let unblend fetch directly from HF, relying on browser **CacheStorage** (`cache: 'force-cache'` style behavior of the worker's fetch) — i.e. first run downloads ~91 MB, later runs hit cache. If that proves unreliable in Electron, implement a `kara:model-bytes` IPC (main streams cached file → renderer → hand to session via `InferenceSession.create` with a buffer). *Decision point during implementation; keep the pipeline API unchanged either way.*
4. **`kara:delete`**: also unlink `<kid>.lyricless.mp4` when present.
5. **CSP** (§7.2) and nothing else structural.

---

## 7. Build, bundling & security considerations

### 7.1 Webpack (renderer) — the fiddly part

- `unblend` is ESM and spawns workers with `new Worker(new URL('./workers/*.js', import.meta.url))`. webpack 5 handles that pattern natively **if** the package isn't pre-bundled by something else; verify in a spike (§10, task S1). If webpack emits the workers as separate chunks, ensure they're copied to the output (they will be — webpack emits them automatically from `new URL(..., import.meta.url)`).
- **ORW `.wasm` assets:** onnxruntime-web ships `*.wasm` + `ort-wasm-simd-threaded.jswasm` etc. Two options:
  - (a) let webpack emit them via `asset/resource` rules (mirroring the existing video.js font/image rules in `webpack.renderer.config.ts`) and pass `wasmPaths` pointing at the emitted base;
  - (b) set `Separator.load(..., { wasmPaths: '<cdn or app:// prefix>' })`.
  - **Choose (a)** — offline-friendly, no extra CDN dependency. Spike S1 must confirm which files ORT requests and that `wasmPaths` resolves them in both dev (webpack-dev-server origin) and prod (file/`app` origin).
- **Native-module asset relocator trap:** `webpack.rules.ts` routes *everything* under `node_modules` through `@vercel/webpack-asset-relocator-loader` for `.m?js|.node`. ORT's JS is ESM and its workers must be emitted as worker chunks, not "relocated assets". Add an **exclude** for `onnxruntime-web` (and possibly `unblend`) from that rule, or scope the reloader to known native modules. Verify in spike S1 — this is the most likely build-time failure.
- `mediabunny` is plain ESM TS output — no special handling expected; confirm tree-shaking keeps the bundle sane (only MP4 read + MP4 write + AAC encode paths).
- Main-process webpack: **no changes** (pipeline runs in renderer). No native modules added → Forge packaging unchanged.

### 7.2 CSP updates (`applyCsp()`)

```
connect-src 'self' https://kara.moe https://huggingface.co
worker-src 'self' blob:
```
- `https://huggingface.co` — unblend's worker fetches ONNX weights (and possibly ORT wasm if we ever use CDN option b).
- `worker-src 'self' blob:` — webpack-emitted workers may be loaded via blob in dev; allow both.
- Everything else stays identical. Keep `applyCsp()` the single source of truth (project convention §12.2).

### 7.3 Cross-origin isolation / WASM threads

- ORT's multithreaded WASM needs COOP/COE headers. Our app is a single window; adding `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` in `onHeadersReceived` would enable it — **but** COEP blocks cross-origin subresources without CORP (video.js fonts are local, HF fetches send CORP from HF… needs verification).
- **Decision:** v1 runs with the default single-threaded WASM (or WebGPU when available — WebGPU does not need COOP/COE). Add COOP/COE as an opt-in experiment in spike S2; adopt only if separation time drops materially and nothing breaks.

### 7.4 Memory profile (renderer)

For a ~3–4 min song at 44.1 kHz stereo: raw PCM ≈ 450 MB *fp32 interleaved*… actually 44100 × 2 ch × 4 B × 240 s ≈ **84 MB** per full-mix Float32Array; unblend processes in segments (its own pipeline), stems come back as 4 arrays (~84 MB each for htdemucs → ~340 MB peak). Plus the video ArrayBuffer (≈ file size, typically 10–50 MB) and mediabunny's output buffer. Expect **~0.5–1 GB peak** — fine for a desktop app window; do not stream both video files in the player simultaneously (§5.2).

---

## 8. Failure modes & edge cases

| Case | Handling |
|---|---|
| No WebGPU | unblend auto-falls back to WASM (default models). Show backend used in a console log / small UI note. `bs_roformer_sw`/`scnet_xl_wide_v5` are excluded from v1 model choice precisely because they reject non-WebGPU browsers. |
| Audio track not AAC/decodable (odd container) | mediabunny reports via `conversion.discardedTracks` / decode errors → surface a clear toast: "Audio could not be decoded." No partial files left behind (temp `.part` cleaned on error). |
| Video codec not MP4-compatible for copy (e.g. HEVC in mp4 is fine; MPEG-2 video would fail) | Check `conversion.isValid` + `discardedTracks` before executing; if the *video* track would be discarded, fall back to re-encoding with a WebCodecs-supported codec (`hvc1`/`avc1` depending on `canEncodeVideo`) — or reject with a message. kara.moe hardsubs are H.264 MP4 in practice; verify in spike S3. |
| Separation aborted (user navigates away) | Abort via `AbortSignal` on unmount of the starting view; note unblend invalidates the instance on abort — reload next time. Clean up `.part` file in main on error path. |
| Re-run while a lyricless file exists | Overwrite via `.part` + rename (atomic). Player keeps playing the old blob URL until regenerated (no disruption). |
| Catalog entry deleted mid-pipeline | `kara:write-lyricless` rejects (entry gone); renderer shows toast; no orphan files. |
| First-run model download interrupted | Partial ONNX removed; next run re-downloads. (CacheStorage fallback handles this itself if we use it.) |
| Very long videos (>10 min) | unblend is segment-based, fine; warn user with an estimated-time note in the overlay ("this can take a few minutes"). |
| Dev vs prod origin differences | All media via existing IPC→Blob pattern; workers/wasm emitted by webpack in both modes (spike S1 must test `npm start` and `npm run package`). |

---

## 9. Testing & acceptance checklist

No test suite exists yet (see implementation.md §12); keep verification manual + a couple of node-side unit tests for pure math.

**Unit (node, no DOM):**
- [ ] `stems.ts`: sum-excluding-vocals produces correct interleaved output; clipping behaves; mono→stereo duplication matches unblend's contract.

**Manual E2E (`npm start`):**
1. [ ] Download a song (existing flow still works — regression).
2. [ ] Catalog row shows *Lyricless* button; click → overlay with stage labels + moving bar; percent reaches 100; toast-free success; catalog reloads and button becomes "Reprocess".
3. [ ] `~/.config/vocal-vanish/kara-catalog/` contains `<kid>.lyricless.mp4`; original file byte-identical (checksum before/after).
4. [ ] Player: *Original* tab plays the hardsubbed video; *Lyricless* tab plays the same video with vocals removed (instrumental audible, no lead vocal); switching tabs swaps audio without reload glitches; object URLs revoked on unmount (DevTools → no leaked blob refs).
5. [ ] Delete a song → both files gone, index clean.
6. [ ] Second song: model not re-downloaded (check network tab / cache dir).
7. [ ] `npm run package` + run packaged app: pipeline works offline-after-first-run (except HF if uncached), CSP blocks nothing needed, no console CSP errors.
8. [ ] Lint (`npm run lint`) and type-check clean.

**Quality bar for "vocals removed":** on an a cappella-heavy chorus the lead vocal should be substantially gone; slight vocal residue is acceptable (model limitation, document it in README when done).

---

## 10. Implementation order (spikes first)

| # | Task | Notes |
|---|---|---|
| S1 | **Spike: bundle unblend + ORT in the renderer webpack build.** Minimal `npm start` page that loads `htdemucs` fp16 and separates a 10 s test tone file. Resolve worker emission, `.wasm` asset rules, reloader exclude, dev+prod both. | Highest-risk item; do first. |
| S2 | Spike: measure separation time (WebGPU vs WASM) on a real song; decide COOP/COE opt-in. | Informs overlay UX copy. |
| S3 | Spike: mediabunny composable conversion in the renderer — packet-copy video + AAC audio from an `AudioBufferSource` → playable MP4 blob. Verify no video re-encode (compare file sizes / codec). | Second-highest risk. |
| 1 | Deps + build config finalization (`package.json`, webpack rules, CSP). | After spikes confirm the approach. |
| 2 | Main IPC: `write-lyricless`, `lyricless-status`, delete cleanup, index schema. | Small, testable in isolation. |
| 3 | Preload bridge methods + types (`CatalogEntry.lyriclessFile`). | |
| 4 | `src/lyricless/stems.ts` + unit tests. | Pure math. |
| 5 | `src/lyricless/pipeline.ts` (extract → separate → mix → mux) with progress callback. | Composes S1+S3 results. |
| 6 | CatalogView: button, overlay, single-flight state. | |
| 7 | PlayerView: tabs + src swap + lazy blob loading + Generate fallback. | |
| 8 | README + implementation.md updates (new IPC table rows, deps, storage layout note). | Keep the "another AI can continue" quality bar. |

## 11. Assumptions & open questions

- **Model choice:** `htdemucs` fp16 as default. If S2 shows WebGPU is reliably present on target machines and speed is poor, consider `melband_roformer_kim` (vocals + other only — *fewer* stems to recombine: instrumental = `other`, which unblend computes as mixture − vocals; actually this model makes the whole "sum all except vocals" step trivial). Decision after S2.
- **Audio codec/bitrate for output:** AAC 192 kbps stereo (matches typical source quality; MP4 container via mediabunny's `Mp4OutputFormat` + WebCodecs AAC encoder — verify `canEncodeAudio('aac')` in spike S3; Electron/Chromium supports it).
- **kara.moe hardsubs are H.264/AAC MP4** (assumed from the site; confirmed by existing playback working in Chromium). If a song uses an exotic codec, error out cleanly (§8).
- **unblend pinning:** install from a pinned git SHA of `web/unblend`; revisit when/if it lands on npm.
- ~~Model picker settings screen~~ — **done** (see `src/views/ConfigView.vue` + `src/lyricless/models.ts`).
- Not doing in v1: cancel button (abort exists in the API — easy follow-up), batch processing, per-stem volume mixing UI.

## 12. References

- unblend browser API: https://github.com/Ryan5453/unblend/blob/main/web/unblend/README.md
- unblend repo (workspaces; lib at `web/unblend`): https://github.com/Ryan5453/unblend
- mediabunny docs: https://mediabunny.dev/ — conversion guide: https://mediabunny.dev/guide/converting-media-files (composable conversions), server variant: https://github.com/Vanilagy/mediabunny/blob/main/packages/server/README.md
- Current app architecture: [docs/implementation.md](./implementation.md) (§3 process split, §6 preload/media streaming, §7 CSP, §9 webpack quirks, §12 conventions)

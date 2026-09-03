# Lyricless Video Generation — Implementation Summary

## Overview

The lyricless feature turns a downloaded hardsubbed karaoke video into a vocal-free version entirely inside the Electron app. No Python, no ffmpeg binaries — only npm packages running in the renderer process.

**Pipeline:** decode audio → stem separation (htdemucs) → recombine non-vocal stems → re-mux with original video → write new file. The original `.mp4` is never modified.

## Architecture

All DSP happens in the **renderer** (the only place Web Audio, WebGPU/WASM, and WebCodecs are available). The main process handles file I/O via IPC.

```
Renderer                          Main Process
─────────                         ────────────
fetch video bytes ◄──IPC──        read <kid>.mp4 from catalog dir
decodeAudioData (Web Audio)
resample → 44.1 kHz
unblend Separator.load + separate
  (ONNX Runtime: WebGPU or WASM)
recombine drums+bass+other
mediabunny Conversion (video copy + Opus encode)
write new MP4 ────IPC────────►   atomic write <kid>.lyricless.mp4
                                  update catalog.json
```

## Key files

| File | Role |
|------|------|
| `src/lyricless/pipeline.ts` | Full pipeline orchestration: decode → separate → mux. Exports `generateLyricless(videoBytes, onProgress)`. |
| `src/lyricless/stems.ts` | Audio decode, 44.1 kHz resample, unblend separator load/separate/recombine. Model caching via IPC. |
| `src/views/CatalogView.vue` | Per-row *Lyricless* button + full-screen progress overlay (`.overlay`/`.bar` pattern). |
| `src/views/PlayerView.vue` | Original / Lyricless tab bar. Lazy-loads lyricless blob on first tab switch. Placeholder + Generate button when not yet created. |
| `src/index.ts` | IPC handlers: `kara:write-lyricless`, `kara:lyricless-status`, `kara:model-status`, `kara:model-stream`, `kara:save-model`. Delete removes both files. `kara:media-stream` accepts a `variant` param. |
| `src/preload.ts` | Bridge: `writeLyricless()`, `lyriclessStatus()`, `modelStatus()`, `openModelStream()`, `saveModel()`, `openMediaStream(kid, variant?)`. |

## Stem separation (unblend)

- **Library:** [unblend](https://github.com/Ryan5453/unblend) v1.0.0, pinned via a local tarball (`unblend-1.0.0.tgz` at repo root, installed as `"unblend": "file:unblend-1.0.0.tgz"`).
- **Model:** htdemucs fp16 (~91 MB ONNX), fetched from HuggingFace on first use and cached in `userData/htdemucs_fp16.onnx`. Subsequent runs load from disk via IPC (no re-download).
- **Backend:** WebGPU preferred, automatic WASM fallback. ORT wasm sidecars are copied to `main_window/ort/` by CopyWebpackPlugin; the directory URL is passed as `wasmPaths`.
- **Output:** htdemucs produces 4 interleaved-stereo stems (drums, bass, other, vocals). We sum drums + bass + other and clamp to [-1, 1].

## Re-muxing (mediabunny)

- **Library:** [mediabunny](https://mediabunny.dev/) 1.55.5 (pure JS, WebCodecs-based).
- **Strategy:** Two composable sources on one `Output`:
  - A `Conversion` copies video packets from the original MP4 (no transcode).
  - An `AudioSampleSource` (Opus, 128 kbps) is attached via `output.addAudioTrack()`. The recombined stems are resampled to 48 kHz (WebCodecs requirement) and fed in ~1-second chunks.
- **Output:** MP4 with original video + Opus audio → `BufferTarget.buffer` → written to disk via IPC.

## WebGPU enablement

Two Chromium flags are set at app startup (`src/index.ts`) before the window is created:

```ts
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "ForceEnableWebGpuInterop");
```

These allow WebGPU to function in Electron's sandboxed renderer. Without them, `navigator.gpu.requestAdapter()` returns null and unblend falls back to WASM.

## CSP additions

The `connect-src` directive includes:

- `blob:` — for object URLs (model loading, media streaming)
- `https://huggingface.co` + `https://*.hf.co` + `https://*.huggingface.co` — model download CDN

## Storage

| Path | Contents |
|------|----------|
| `userData/kara-catalog/<kid>.lyricless.mp4` | Generated lyricless video |
| `userData/kara-catalog/catalog.json` | Index; each entry may have `lyriclessFile: "<kid>.lyricless.mp4"` |
| `userData/htdemucs_fp16.onnx` | Cached ONNX model (~91 MB) |

## Webpack configuration notes

- **unblend + onnxruntime-web** are excluded from the asset relocator (`webpack.rules.ts`) so webpack bundles ORT into the worker chunks. Without this, the workers would be raw file copies with unresolvable bare imports.
- **CopyWebpackPlugin** copies `node_modules/onnxruntime-web/dist/` → `.webpack/renderer/main_window/ort/` so the wasm sidecars are served at `/main_window/ort/`.
- **DefinePlugin** injects Vue feature flags (`__VUE_OPTIONS_API__`, etc.) to silence the esm-bundler warning.

## UI behavior

- **Catalog:** Each row shows a *Lyricless* button (disabled while any processing runs) and a "Lyricless" badge when `entry.lyriclessFile` is set. Clicking the button opens a full-screen overlay with stage label + percentage bar (decode 0–10%, separate 10–80%, mux 80–100%).
- **Player:** Tab bar switches between Original and Lyricless. The lyricless file is lazy-loaded on first tab switch. If it doesn't exist, a placeholder message + *Generate Lyricless* button (routes to Catalog) is shown.

# vocal-vanish

A small desktop app (Electron + Vue) that consumes the [Kara moe API](https://kara.moe/api/) to build a **local catalog of karaoke anime videos** with hardcoded subtitles (hardsubs).

This is a proof of concept. The UI is intentionally simple and minimal.

## Features

- **Search** — search the Kara moe database by title / series / singer, year, or song ID (KID), with paginated results.
- **Download** — download a song's hardsubbed video into a local catalog folder, with a live progress overlay.
- **Catalog** — browse your downloaded songs (title, series, singer, duration), filter them, and delete entries.
- **Lyricless** — generate a vocal-free version of any downloaded song using in-app AI stem separation ([unblend](https://github.com/Ryan5453/unblend) / htdemucs via ONNX Runtime on WebGPU). The original video is never modified; a new `<kid>.lyricless.mp4` file is produced.
- **Player** — play any downloaded video with [video.js](https://www.videojs.com/). The subtitles are already burned into the video, so plain playback shows the karaoke lyrics. Toggle between **Original** and **Lyricless** audio in the player.

## Screens

1. **Search** (main screen) — search bar + criteria dropdown, paginated result rows, per-row *Download* button and loading overlay.
2. **Catalog** (via side menu) — searchable list of downloaded songs with *Play* / *Lyricless* / delete buttons. A "Lyricless" badge appears on entries that already have a generated vocal-free version.
3. **Player** — minimal video.js player for the selected song, with an Original / Lyricless tab to switch between the full mix and the stem-separated instrumental.

## Tech stack

| Layer      | Technology                                              |
|------------|---------------------------------------------------------|
| Shell      | Electron (built with [Electron Forge](https://www.electronforge.io/) + Webpack) |
| UI         | Vue 3 (Composition API, `<script setup>`) + Vue Router 4 |
| Video      | video.js 8                                             |
| Stem sep.  | [unblend](https://github.com/Ryan5453/unblend) (htdemucs ONNX) via [onnxruntime-web](https://onnxruntime.ai/) on WebGPU |
| Re-mux     | [mediabunny](https://mediabunny.dev/) (WebCodecs, pure JS) |
| Language   | TypeScript                                             |
| Backend    | Node `https` module only (no extra HTTP dependencies)   |

## Getting started

```bash
npm install
npm start          # run in development (hot reload)
```

Other scripts:

```bash
npm run lint       # eslint
npm run package    # bundle for the current platform (no installer)
npm run make       # build distributable installers
```

## Where files are stored

Downloads go to the Electron `userData` directory under a `kara-catalog/` subfolder:

- **Linux:** `~/.config/vocal-vanish/kara-catalog/`
- **macOS:** `~/Library/Application Support/vocal-vanish/kara-catalog/`
- **Windows:** `%APPDATA%/vocal-vanish/kara-catalog/`

Each video is saved as `<kid>.<size>.<hash>.mp4`, and a `catalog.json` index file tracks metadata (title, series, singer, duration, size, download date) keyed by KID. Generated lyricless versions are stored alongside as `<kid>.lyricless.mp4`. The htdemucs ONNX model (~91 MB) is cached once in the `userData` root and reused across sessions.

## API used

Only the Kara moe API is used — no other data source:

- Base URL: `https://kara.moe/api`
- Search: `GET /karas/search?filter=<text>&from=<offset>&size=<limit>` (or structured `q=` filters)
- Song detail: `GET /karas/{kid}`
- Hardsub video: `GET /hardsubs/<hardsubbed_mediafile>` (the filename comes from the song's `hardsubbed_mediafile` field)

## Documentation

- [`docs/implementation.md`](docs/implementation.md) — full walkthrough of the architecture, data flow, IPC contract, storage layout, and build/tooling quirks. Written so another AI can pick up and extend the project.
- [`docs/lyricless-plan.md`](docs/lyricless-plan.md) — the original implementation plan for the lyricless feature (research, design decisions, constraints).
- [`docs/lyricless-implementation.md`](docs/lyricless-implementation.md) — summary of how the lyricless pipeline is implemented: architecture, key files, WebGPU enablement, re-muxing strategy, and storage.

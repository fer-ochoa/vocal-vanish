# vocal-vanish

A small desktop app (Electron + Vue) that consumes the [Kara moe API](https://kara.moe/api/) to build a **local catalog of karaoke anime videos** with hardcoded subtitles (hardsubs).

This is a proof of concept. The UI is intentionally simple and minimal.

## Features

- **Search** — search the Kara moe database by title / series / singer, year, or song ID (KID), with paginated results.
- **Download** — download a song's hardsubbed video into a local catalog folder, with a live progress overlay.
- **Catalog** — browse your downloaded songs (title, series, singer, duration), filter them, and delete entries.
- **Player** — play any downloaded video with [video.js](https://www.videojs.com/). The subtitles are already burned into the video, so plain playback shows the karaoke lyrics.

## Screens

1. **Search** (main screen) — search bar + criteria dropdown, paginated result rows, per-row *Download* button and loading overlay.
2. **Catalog** (via side menu) — searchable list of downloaded songs with *Play* / delete buttons.
3. **Player** — minimal video.js player for the selected song.

## Tech stack

| Layer      | Technology                                              |
|------------|---------------------------------------------------------|
| Shell      | Electron (built with [Electron Forge](https://www.electronforge.io/) + Webpack) |
| UI         | Vue 3 (Composition API, `<script setup>`) + Vue Router 4 |
| Video      | video.js 8                                             |
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

Each video is saved as `<kid>.<size>.<hash>.mp4`, and a `catalog.json` index file tracks metadata (title, series, singer, duration, size, download date) keyed by KID.

## API used

Only the Kara moe API is used — no other data source:

- Base URL: `https://kara.moe/api`
- Search: `GET /karas/search?filter=<text>&from=<offset>&size=<limit>` (or structured `q=` filters)
- Song detail: `GET /karas/{kid}`
- Hardsub video: `GET /hardsubs/<hardsubbed_mediafile>` (the filename comes from the song's `hardsubbed_mediafile` field)

## Documentation

See [`docs/implementation.md`](docs/implementation.md) for a full walkthrough of the architecture, data flow, IPC contract, storage layout, and the build/tooling quirks that were worked around. That file is written so another AI can pick up and extend the project.

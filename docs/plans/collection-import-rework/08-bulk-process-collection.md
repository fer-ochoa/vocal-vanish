# Feat 08 — Bulk processing (lyricless) inside a collection
## Goal
Inside a collection — local or imported — the user can generate lyricless versions for every eligible song in one action, mirroring the existing "Download all missing" bulk button.
## Reference
- Overview "The model" (a collection is `local` or `imported`; imported collections are read-only local copies).
- Feat 04 (imported detail view: the "Download all missing (N)" header button and its progress overlay / `onCollectionDownloadProgress` wiring).
- Existing `src/views/CatalogView.vue` `startLyricless` (the single-song lyricless pipeline) and `src/lyricless/pipeline.ts` (WebGPU/WASM stem separation).
## Scope
### Add
- `src/views/CollectionDetailView.vue` — the header gets a `Process all (N)` button next to `Download all missing (N)`. It is shown for BOTH local and imported collections (unlike the download/sync buttons, which are imported-only).
  - Eligibility filter: a song is processed only when it is (a) already downloaded (`downloaded === true`), (b) NOT off-vocal (`offVocal !== true`), and (c) has no lyricless variant yet (`lyriclessFile` empty). N is that count; the button is disabled when N is 0.
  - Off-vocal songs are excluded because they are already instrumental — there is no vocal to remove. Not-downloaded songs are excluded because there are no bytes to decode.
  - Architecture: unlike bulk download, which runs in the main process over IPC (`kara:collection-download`), stem separation is renderer-only (WebGPU/WASM via unblend + Web Audio + mediabunny re-mux). The bulk loop therefore runs in the renderer, strictly sequentially, one song at a time, because a single ONNX session is GPU-bound. No new IPC channel was added.
  - Progress UI: an overlay reusing the bulk-download styling shows `Processing X / Y`, the current song title, the pipeline stage label (Decoding / Separating stems N% / Re-muxing N%) and an overall percentage using the same stage weighting as the Catalog screen (decode 10%, separate 70%, mux 20%). On completion it reports processed / skipped / failed, lists the failures with their error messages, and offers Close.
  - A single song failing never aborts the batch; failures are collected and reported at the end.
  - Rows update in place as each song finishes (the `Lyricless` chip appears immediately); the list is reloaded from the DB at the end. Imported rows now also show the `Lyricless` chip.
  - Bulk processing and bulk download are mutually exclusive: each is disabled while the other runs.
- `src/lyricless/processSong.ts` — new shared helper extracted from `CatalogView.startLyricless`: `processSongLyricless(kid, onProgress)` plus `pipelineOverallPct(p)`, now used by both the Catalog screen and the collection detail screen.
### Explicitly not in this feat
- No cancellation mid-batch.
- No concurrency above 1.
- No automatic processing on import or on download.
- No new DB columns (`lyricless_file` already exists) and no schema change.
- No changes to `src/index.ts`, `src/preload.ts`, `src/global.d.ts` or `src/db/*`.
## Acceptance criteria
- The button appears in both local and imported collections and shows the correct eligible count.
- It is disabled when no song qualifies, and while a bulk download or a single download is running.
- Running it processes exactly the downloaded, non-off-vocal, not-yet-processed songs, one at a time, and skips everything else.
- Each processed song gains its lyricless variant and the `Lyricless` chip without a manual refresh.
- A failing song is reported in the summary and does not stop the remaining songs.
- `npm run lint` passes.

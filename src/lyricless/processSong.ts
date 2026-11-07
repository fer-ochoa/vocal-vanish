/**
 * Shared per-song lyricless entry point.
 *
 * Both the Catalog screen and the Collection detail screen generate a
 * lyricless version of a single song through this helper, so the decode →
 * separate → re-mux flow and the overall-progress mapping live in one place.
 */
import { generateLyricless } from './pipeline';
import type { PipelineProgress } from './pipeline';

/**
 * Generate the lyricless version of a single song and persist it.
 *
 * Streams the original video bytes from the main process, runs the full
 * renderer-side pipeline (decode → separate → re-mux), then writes the result
 * to disk and updates the DB row.
 *
 * @param kid         The song's kid.
 * @param onProgress  Optional progress callback.
 * @returns The kid and the resulting lyricless file name.
 */
export async function processSongLyricless(
  kid: string,
  onProgress?: (p: PipelineProgress) => void,
): Promise<{ kid: string; lyriclessFile: string }> {
  // Stream the original video bytes from the main process.
  const buf = await window.kara.openMediaStream(kid);
  // Run the full pipeline: decode → separate → re-mux.
  const lyriclessBytes = await generateLyricless(buf, onProgress);
  // Write the result to disk via IPC.
  await window.kara.writeLyricless(kid, lyriclessBytes);
  return { kid, lyriclessFile: `${kid}.lyricless.mp4` };
}

/**
 * Map a pipeline stage progress to an overall 0..100 percentage.
 *
 * Uses the same weighting the Catalog screen has always used: decode is 10%,
 * separate is 70%, and mux is the remaining 20%.
 *
 * @param p  The current pipeline progress.
 * @returns  The overall percentage (0..100).
 */
export function pipelineOverallPct(p: PipelineProgress): number {
  const stageWeight = p.stage === 'decode' ? 0.1 : p.stage === 'separate' ? 0.7 : 0.2;
  const stageStart = p.stage === 'decode' ? 0 : p.stage === 'separate' ? 10 : 80;
  return Math.round(stageStart + p.fraction * stageWeight * 100);
}

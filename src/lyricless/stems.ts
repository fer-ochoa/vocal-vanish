/**
 * Stem separation and recombination for the lyricless pipeline.
 *
 * Uses unblend's Separator (htdemucs model) to split audio into
 * drums / bass / other / vocals, then sums everything except vocals
 * back into a single interleaved-stereo Float32Array.
 */

import { Separator } from "unblend";

/** Progress callback for the stem separation stage. */
export interface StemProgress {
  /** 0..1 fraction of segments processed. */
  fraction: number;
  /** Current segment index (1-based). */
  segIdx: number;
  /** Total number of segments. */
  totalSegs: number;
}

/**
 * Decode an ArrayBuffer of audio bytes into a 44.1 kHz AudioBuffer.
 * The browser's decodeAudioData handles MP3/AAC/OGG/WAV transparently.
 */
export async function decodeAudio(
  arrayBuffer: ArrayBuffer,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    // Some browsers require a non-zero length; retry with a larger buffer.
    const ctx2 = new AudioContext({ sampleRate: 44100 });
    try {
      return await ctx2.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      await ctx2.close();
    }
  }
}

/**
 * Resample an AudioBuffer to exactly 44.1 kHz using OfflineAudioContext.
 * unblend requires its input to be 44.1 kHz, 1–2 channels.
 */
export async function resampleTo44100(
  buffer: AudioBuffer,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === 44100) return buffer;
  const length = Math.ceil(buffer.duration * 44100);
  const ctx = new OfflineAudioContext(2, length, 44100);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

/**
 * Separate an AudioBuffer into stems and recombine all non-vocal stems
 * (drums + bass + other) into a single interleaved-stereo Float32Array.
 *
 * @param audio  A 44.1 kHz, 1–2 channel AudioBuffer.
 * @param onProgress  Optional callback for per-segment progress.
 * @returns An object with the recombined stem data and the separator
 *          (call `separator.unload()` when done to free GPU/CPU resources).
 */
export async function separateAndRecombine(
  audio: AudioBuffer,
  onProgress?: (p: StemProgress) => void,
): Promise<{
  interleaved: Float32Array;
  numSamples: number;
  separator: Separator;
}> {
  // ORT's wasm sidecars are copied to main_window/ort/ by CopyWebpackPlugin
  // (see webpack.renderer.config.ts). We pass the directory URL as wasmPaths —
  // ORT's internal Sf() does `new URL(filename, wasmPaths)` so it must be a
  // base directory, not a file URL. The page is served from /main_window/,
  // so 'ort/' resolves correctly relative to document.baseURI.
  const ortWasmDir = new URL("ort/", document.baseURI).href;

  // Check if the model is cached locally (avoids re-downloading ~91 MB).
  let modelUrl: string | undefined;
  const status = await window.kara.modelStatus();
  if (status.cached) {
    const buf = await window.kara.openModelStream();
    modelUrl = URL.createObjectURL(
      new Blob([buf], { type: "application/octet-stream" }),
    );
  }

  const separator = await Separator.load("htdemucs", {
    precision: "fp16",
    backend: "webgpu",
    wasmPaths: ortWasmDir,
    // Single-threaded WASM: cross-origin isolation isn't enabled in this app,
    // so multi-threaded WebAssembly would fail. 1 thread avoids the warning.
    numThreads: 4,
    ...(modelUrl ? { modelUrl } : {}),
  });

  // If we used a blob URL for the model, revoke it after loading.
  if (modelUrl) URL.revokeObjectURL(modelUrl);

  try {
    const result = await separator.separate(audio, {
      onProgress: (p) => {
        if (onProgress && p.stage === "completed") {
          // p is { stage, segIdx, totalSegs, fraction }
          onProgress({
            fraction: p.fraction ?? 0,
            segIdx: p.segIdx ?? 0,
            totalSegs: p.totalSegs ?? 1,
          });
        }
      },
    });

    const stems = result.stems;
    // htdemucs produces: drums, bass, other, vocals (all interleaved stereo).
    const nonVocalKeys = ["drums", "bass", "other"].filter((k) => k in stems);
    if (nonVocalKeys.length === 0) {
      throw new Error("Stem separation produced no usable stems.");
    }

    // All stems are interleaved stereo: [L0, R0, L1, R1, ...]
    const numSamples = stems[nonVocalKeys[0]].length / 2;
    const out = new Float32Array(numSamples * 2);

    for (const key of nonVocalKeys) {
      const stem = stems[key];
      for (let i = 0; i < out.length; i++) {
        out[i] += stem[i];
      }
    }

    // Clamp to [-1, 1] to avoid overflow when summing multiple stems.
    for (let i = 0; i < out.length; i++) {
      if (out[i] > 1) out[i] = 1;
      else if (out[i] < -1) out[i] = -1;
    }

    return { interleaved: out, numSamples, separator };
  } catch (err) {
    await separator.unload();
    throw err;
  }
}

/**
 * Build a new AudioBuffer from interleaved-stereo Float32Array data.
 */
export function buildAudioBuffer(
  interleaved: Float32Array,
  numSamples: number,
  sampleRate = 44100,
): AudioBuffer {
  const ctx = new OfflineAudioContext(2, numSamples, sampleRate);
  const buffer = ctx.createBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < numSamples; i++) {
    left[i] = interleaved[i * 2];
    right[i] = interleaved[i * 2 + 1];
  }
  return buffer;
}

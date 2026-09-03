/**
 * Stem separation and recombination for the lyricless pipeline.
 *
 * Uses unblend's Separator (htdemucs model) to split audio into
 * drums / bass / other / vocals, then sums everything except vocals
 * back into a single interleaved-stereo Float32Array.
 */

import { Separator, MODEL_CONFIGS } from "unblend";
import type { ModelType } from "unblend";

/** Progress callback for the stem separation stage. */
export interface StemProgress {
  /** 0..1 fraction of segments processed. */
  fraction: number;
  /** Current segment index (1-based). */
  segIdx: number;
  /** Total number of segments. */
  totalSegs: number;
}

/** Cached result of the WebGPU f16 capability probe (avoids re-probing). */
let webgpuF16Cache: boolean | null = null;

/**
 * Probe whether the GPU supports the `shader-f16` WebGPU feature, which is
 * required for ORT to run fp16 ONNX tensors on the WebGPU backend.
 *
 * ORT's WebGPU EP generates WGSL shaders with `f16` types for fp16 tensors
 * but only adds the `enable f16;` directive when this feature is available.
 * Without it, shader compilation fails silently and every subsequent GPU
 * operation cascades into "invalid due to a previous error" validation
 * errors — producing silent no-audio output.
 *
 * @returns true if WebGPU + shader-f16 are both available; false otherwise.
 */
export async function detectWebGpuF16(): Promise<boolean> {
  if (webgpuF16Cache !== null) return webgpuF16Cache;
  try {
    const nav = navigator as Navigator & { gpu?: GPU };
    const gpu = nav.gpu;

    const adapter_ = await navigator.gpu?.requestAdapter();

    console.log("=== FEATURES ===");
    console.log([...adapter_?.features]);

    console.log("=== INFO ===");
    console.log(adapter_?.info);

    console.log("=== LIMITS ===");
    console.log({
      maxBufferSize: adapter_?.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter_?.limits.maxStorageBufferBindingSize,
    });

    const device = await adapter_?.requestDevice({
      requiredFeatures: ["shader-f16"],
    });
    console.log("=== DEVICE FEATURES ===");
    console.log(device);

    if (!gpu) {
      webgpuF16Cache = false;
      return false;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      webgpuF16Cache = false;
      return false;
    }
    // Check for the shader-f16 feature on the adapter. This is what ORT
    // checks internally (device.features.has("shader-f16")) before adding
    // `enable f16;` to WGSL shaders.
    webgpuF16Cache = adapter.features.has("shader-f16");
  } catch {
    webgpuF16Cache = false;
  }
  return webgpuF16Cache;
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
 * (drums + bass + other, or the model's "other" complement stem) into a
 * single interleaved-stereo Float32Array.
 *
 * @param audio  A 44.1 kHz, 1–2 channel AudioBuffer.
 * @param onProgress  Optional callback for per-segment progress.
 * @param model  The unblend model id (from the Config screen). Defaults to
 *               htdemucs.
 * @returns An object with the recombined stem data and the separator
 *          (call `separator.unload()` when done to free GPU/CPU resources).
 */
export async function separateAndRecombine(
  audio: AudioBuffer,
  onProgress?: (p: StemProgress) => void,
  model: ModelType = "htdemucs",
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

  // Check if the model is cached locally (avoids re-downloading on first run).
  let modelUrl: string | undefined;
  const status = await window.kara.modelStatus(model);
  if (status.cached) {
    const buf = await window.kara.openModelStream(model);
    modelUrl = URL.createObjectURL(
      new Blob([buf], { type: "application/octet-stream" }),
    );
  }

  // Determine the backend. WebGPU is preferred, but fp16 ONNX tensors require
  // the GPU's `shader-f16` feature for ORT to compile WGSL shaders with f16
  // types. Without it, every pipeline creation fails and inference produces
  // silent garbage (no-audio output). Fall back to WASM when f16 is missing —
  // except for models that unblend refuses to run on WASM (webgpuRequired),
  // which get a clear error instead of a guaranteed crash.
  const config = MODEL_CONFIGS[model];
  let backend: "webgpu" | "wasm" = "webgpu";
  if (config.webgpuRequired) {
    const hasF16 = await detectWebGpuF16();
    if (!hasF16) {
      throw new Error(
        `${model} requires WebGPU with the shader-f16 feature, but this GPU ` +
          "does not support it. The model uses fp16 weights that cannot be " +
          "compiled to WGSL without f16 support. Try a different model or a " +
          "GPU with shader-f16 support.",
      );
    }
  } else {
    // Non-required models: prefer WebGPU, but fall back to WASM if the GPU
    // can't handle fp16 shaders. This prevents the silent no-audio failure.
    const hasF16 = await detectWebGpuF16();
    if (!hasF16) {
      backend = "wasm";
    }
  }

  const separator = await Separator.load(model, {
    precision: "fp16",
    backend,
    wasmPaths: ortWasmDir,
    // numThreads only applies to the WASM backend (unblend ignores it for
    // WebGPU). Cross-origin isolation isn't enabled in this app, so keep it
    // at 4 — ORT's default — and let unblend handle thread negotiation.
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
    // Pick the non-vocal stems to sum, per model family:
    // - multi-stem models (htdemucs/htdemucs_6s/scnet): sum drums+bass+other.
    // - complement models (melband_roformer_kim): unblend already computes
    //   "other" = mixture − vocals as a single stem, so use just that one.
    const config = MODEL_CONFIGS[model];
    let nonVocalKeys: string[];
    if (config.complement) {
      nonVocalKeys = [config.complement.name].filter((k) => k in stems);
    } else {
      nonVocalKeys = ["drums", "bass", "other"].filter(
        (k) => config.modelSources.includes(k) && k in stems,
      );
    }
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

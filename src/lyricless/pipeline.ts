/**
 * Full lyricless-video pipeline (runs entirely in the renderer):
 *   1. Decode the original video's audio track via the Web Audio API.
 *   2. Resample to 44.1 kHz for unblend.
 *   3. Stem-separate with htdemucs; recombine drums+bass+other (drop vocals).
 *   4. Re-mux with mediabunny: copy original video packets + AAC-encode the
 *      new audio into a brand-new MP4 file. The original is never modified.
 */

import {
  Input,
  Output,
  Conversion,
  MP4,
  Mp4OutputFormat,
  BufferTarget,
  BlobSource,
  AudioSampleSource,
  AudioSample,
  Quality,
} from 'mediabunny';
import { decodeAudio, resampleTo44100, separateAndRecombine } from './stems';

/** Progress callback for the full pipeline. */
export interface PipelineProgress {
  /** Stage name. */
  stage: 'decode' | 'separate' | 'mux';
  /** 0..1 fraction within the current stage. */
  fraction: number;
  /** Human-readable label for UI display. */
  label: string;
}

/**
 * Run the full lyricless pipeline on a video file.
 *
 * @param videoBytes  The original MP4 (hardsub) file bytes.
 * @param onProgress  Optional progress callback.
 * @returns The new lyricless MP4 as an ArrayBuffer, ready to be written to
 *          disk via `window.kara.writeLyricless()`.
 */
export async function generateLyricless(
  videoBytes: ArrayBuffer,
  onProgress?: (p: PipelineProgress) => void,
): Promise<ArrayBuffer> {
  const blob = new Blob([videoBytes], { type: 'video/mp4' });

  // -----------------------------------------------------------------------
  // Stage 1: Decode the audio track from the original video.
  // The browser's decodeAudioData handles MP4/AAC transparently.
  // -----------------------------------------------------------------------
  onProgress?.({ stage: 'decode', fraction: 0, label: 'Decoding audio…' });

  const audioUrl = URL.createObjectURL(blob);
  let decodedBuffer: AudioBuffer;
  try {
    const response = await fetch(audioUrl);
    const audioData = await response.arrayBuffer();
    decodedBuffer = await decodeAudio(audioData);
  } finally {
    URL.revokeObjectURL(audioUrl);
  }

  onProgress?.({ stage: 'decode', fraction: 1, label: 'Decoded' });

  // -----------------------------------------------------------------------
  // Stage 2: Resample to 44.1 kHz and stem-separate.
  // -----------------------------------------------------------------------
  const resampled = await resampleTo44100(decodedBuffer);

  // Ensure the model is cached locally (first run downloads ~91 MB from
  // HuggingFace; subsequent runs load from disk).
  onProgress?.({ stage: 'separate', fraction: 0, label: 'Checking model…' });
  const status = await window.kara.modelStatus();
  if (!status.cached) {
    onProgress?.({ stage: 'separate', fraction: 0.05, label: 'Downloading model (first run)…' });
    const MODEL_URL =
      'https://huggingface.co/Ryan5453/unblend/resolve/eda32466a76dc81c5e66af6577dbc20fb219e959/htdemucs_fp16.onnx';
    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error(`Model download failed: HTTP ${resp.status}`);
    const modelBytes = await resp.arrayBuffer();
    await window.kara.saveModel(modelBytes);
  }

  onProgress?.({ stage: 'separate', fraction: 0.1, label: 'Separating stems…' });

  const { interleaved, numSamples, separator } = await separateAndRecombine(
    resampled,
    (p) => {
      onProgress?.({
        stage: 'separate',
        fraction: p.fraction,
        label: `Separating stems… ${Math.round(p.fraction * 100)}%`,
      });
    },
  );

  // -----------------------------------------------------------------------
  // Stage 3: Re-mux — copy video packets + AAC-encode the new audio.
  // Two composable conversions target the same Output: one copies the video
  // track from the original, the other drives an AudioSampleSource with our
  // recombined stems. The caller starts and finalizes the output.
  // -----------------------------------------------------------------------
  onProgress?.({ stage: 'mux', fraction: 0, label: 'Re-muxing…' });

  const muxOutput = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  // --- 3a: Video track — copy packets from the original --------------------
  const videoInput = new Input({ source: new BlobSource(blob), formats: [MP4] });
  const videoConversion = await Conversion.init({
    input: videoInput,
    output: muxOutput,
    composable: true,
    video: {}, // no codec → packet copy
    audio: { discard: true },
  });

  // --- 3b: Audio track — encode our recombined stems as Opus ---------------
  // WebCodecs AAC encoders are unreliable across Chromium/Electron builds
  // (often missing or limited to specific configurations). Opus is universally
  // supported by WebCodecs and produces excellent quality at lower bitrates.
  const audioSource = new AudioSampleSource({
    codec: 'opus',
    quality: new Quality({ bitrate: 128000 }),
  });
  muxOutput.addAudioTrack(audioSource);

  // Start the output (required before feeding samples in composable mode).
  await muxOutput.start();

  // Resample from 44.1 kHz to 48 kHz using OfflineAudioContext.
  const totalFrames48 = Math.ceil((numSamples / 44100) * 48000);
  const resampleCtx = new OfflineAudioContext(2, totalFrames48, 48000);
  const srcBuf = resampleCtx.createBuffer(2, numSamples, 44100);
  {
    const l = srcBuf.getChannelData(0);
    const r = srcBuf.getChannelData(1);
    for (let i = 0; i < numSamples; i++) {
      l[i] = interleaved[i * 2];
      r[i] = interleaved[i * 2 + 1];
    }
  }
  const srcNode = resampleCtx.createBufferSource();
  srcNode.buffer = srcBuf;
  srcNode.connect(resampleCtx.destination);
  srcNode.start(0);
  const resampled48 = await resampleCtx.startRendering();

  // Feed the 48 kHz stereo data in ~1-second chunks.
  const chunkFrames = 48000;
  const leftCh = resampled48.getChannelData(0);
  const rightCh = resampled48.getChannelData(1);
  for (let i = 0; i < totalFrames48; i += chunkFrames) {
    const end = Math.min(i + chunkFrames, totalFrames48);
    const frames = end - i;

    const chunkBuf = new AudioBuffer({
      length: frames,
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    chunkBuf.getChannelData(0).set(leftCh.subarray(i, end));
    chunkBuf.getChannelData(1).set(rightCh.subarray(i, end));

    const samples = AudioSample.fromAudioBuffer(chunkBuf, i / 48000);
    for (const sample of samples) {
      await audioSource.add(sample);
      sample.close();
    }
  }
  audioSource.close(); // Signal no more samples will come.

  // Run the video conversion to completion (copies packets from source).
  videoConversion.onProgress = (fraction: number) => {
    onProgress?.({
      stage: 'mux',
      fraction,
      label: `Re-muxing… ${Math.round(fraction * 100)}%`,
    });
  };

  await videoConversion.execute();

  // Finalize the output to get the complete MP4 buffer.
  await muxOutput.finalize();
  const target = muxOutput.target as BufferTarget;
  if (!target.buffer) {
    throw new Error('Re-muxing produced no output data.');
  }
  const lyriclessBytes = target.buffer;

  // Clean up the separator (frees ONNX session + workers).
  await separator.unload().catch(() => {});

  onProgress?.({ stage: 'mux', fraction: 1, label: 'Done' });

  return lyriclessBytes;
}

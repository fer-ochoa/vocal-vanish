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

  onProgress?.({ stage: 'separate', fraction: 0, label: 'Separating stems…' });

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
  // -----------------------------------------------------------------------
  onProgress?.({ stage: 'mux', fraction: 0, label: 'Re-muxing…' });

  const muxInput = new Input({ source: new BlobSource(blob) });
  const muxOutput = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  // Composable conversion: video is copied (no transcode — mediabunny detects
  // that the source codec matches and copies packets directly), audio from the
  // source is discarded. We then feed our recombined stems via AudioSampleSource.
  const muxConversion = await Conversion.init({
    input: muxInput,
    output: muxOutput,
    composable: true,
    video: {},
    audio: { discard: true },
  });

  // For composable conversions, the caller must start the output before the
  // first execute().
  await muxOutput.start();

  // Create an AAC audio source for our recombined stems.
  const audioSource = new AudioSampleSource({
    codec: 'aac',
    quality: new Quality('high'),
  });

  // Feed the interleaved stereo data into the audio source in ~1-second chunks.
  // We build a temporary AudioBuffer per chunk and use AudioSample.fromAudioBuffer.
  const chunkFrames = 44100; // ~1 second
  for (let i = 0; i < numSamples; i += chunkFrames) {
    const end = Math.min(i + chunkFrames, numSamples);
    const frames = end - i;

    // Build a 2-channel AudioBuffer from the interleaved data.
    const ctx = new OfflineAudioContext(2, frames, 44100);
    const chunkBuf = ctx.createBuffer(2, frames, 44100);
    const left = chunkBuf.getChannelData(0);
    const right = chunkBuf.getChannelData(1);
    for (let j = 0; j < frames; j++) {
      left[j] = interleaved[(i + j) * 2];
      right[j] = interleaved[(i + j) * 2 + 1];
    }

    const samples = AudioSample.fromAudioBuffer(chunkBuf, i / 44100);
    for (const sample of samples) {
      await audioSource.add(sample);
    }
  }

  // Run the conversion to completion. Video packets are copied from the source;
  // the new audio is encoded as AAC by mediabunny's internal WebCodecs encoder.
  muxConversion.onProgress = (fraction: number) => {
    onProgress?.({
      stage: 'mux',
      fraction,
      label: `Re-muxing… ${Math.round(fraction * 100)}%`,
    });
  };

  await muxConversion.execute();

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

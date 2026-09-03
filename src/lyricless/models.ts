/**
 * Separation model catalog for the Config screen and the lyricless pipeline.
 *
 * The list mirrors unblend v1.0.0's MODEL_CONFIGS / MODEL_ARTIFACTS (see
 * node_modules/unblend/dist/constants.js + model-artifacts.js). unblend only
 * exports configs, not artifact URLs/sizes, so we keep them here — one place
 * for the dropdown labels, cache file names and first-run download sizes.
 */

import type { ModelType } from 'unblend';

export interface SeparationModelInfo {
  /** unblend model key — passed straight to Separator.load(). */
  id: ModelType;
  /** Human-friendly name shown in the dropdown. */
  label: string;
  /** Short description of what the model outputs / its trade-offs. */
  description: string;
  /** fp16 ONNX weight size in bytes (first-run download). */
  fp16SizeBytes: number;
  /** True when unblend refuses to run this model on the WASM backend. */
  webgpuRequired: boolean;
}

export const SEPARATION_MODELS: SeparationModelInfo[] = [
  {
    id: 'htdemucs',
    label: 'HTDemucs (default)',
    description:
      '4 stems — drums, bass, other, vocals. Good quality/speed balance; runs on both WebGPU and the WASM fallback.',
    fp16SizeBytes: 91_324_835,
    webgpuRequired: false,
  },
  {
    id: 'htdemucs_6s',
    label: 'HTDemucs 6-stem',
    description:
      '6 stems — adds guitar and piano. Slightly better detail on instrumented songs; still runs on WASM.',
    fp16SizeBytes: 59_382_714,
    webgpuRequired: false,
  },
  {
    id: 'scnet_small',
    label: 'SCNet Small',
    description:
      '4 stems — drums, bass, other, vocals. Lightest model (~29 MB); runs on both backends.',
    fp16SizeBytes: 29_081_412,
    webgpuRequired: false,
  },
  {
    id: 'melband_roformer_kim',
    label: 'MelBand RoFormer (kim)',
    description:
      'Vocals + "other" (mixture − vocals). Highest vocal-removal quality of the light models; ~479 MB download.',
    fp16SizeBytes: 478_901_267,
    webgpuRequired: false,
  },
  {
    id: 'bs_roformer_sw',
    label: 'BS RoFormer (sw)',
    description:
      '6 stems — best overall quality but ~364 MB and requires WebGPU; unblend refuses the WASM backend for it.',
    fp16SizeBytes: 363_867_964,
    webgpuRequired: true,
  },
  {
    id: 'scnet_xl_wide_v5',
    label: 'SCNet XL Wide v5',
    description:
      '4 stems — largest SCNet variant (~140 MB); requires WebGPU (its working set exceeds the WASM heap).',
    fp16SizeBytes: 140_330_178,
    webgpuRequired: true,
  },
];

export const DEFAULT_MODEL_ID: ModelType = 'htdemucs';

/** Look up a model by id; falls back to the default so stale settings never break the pipeline. */
export function getModel(id: string | null | undefined): SeparationModelInfo {
  return SEPARATION_MODELS.find((m) => m.id === id) ?? SEPARATION_MODELS[0];
}

/** Cache file name for a model's fp16 ONNX weights (kept in userData). */
export function modelCacheFileName(id: ModelType): string {
  return `${id}_fp16.onnx`;
}

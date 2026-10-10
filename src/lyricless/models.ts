// Model catalog for the Config screen.
//
// The list is derived from the installed unblend package's own registries
// (MODEL_ARTIFACTS + MODEL_CONFIGS) so the dropdown can only ever offer model
// ids that `Separator.load` actually accepts. The main process keeps a small
// matching validation whitelist in src/index.ts; bump both together when the
// unblend dependency changes.

import { MODEL_ARTIFACTS, MODEL_CONFIGS } from 'unblend';
import type { ModelType } from 'unblend';

export interface SeparationModelInfo {
  id: ModelType;
  /** Human-friendly name for the dropdown. */
  label: string;
  /** One-line summary shown under the dropdown. */
  description: string;
  /** Stems the separator returns (includes any complement stem). */
  stems: readonly string[];
  /** Size of the fp16 ONNX artifact we download/cache. */
  sizeBytes: number;
  /** True when the model cannot run on the WASM backend (memory footprint). */
  webgpuRequired: boolean;
  /** License of the model weights. */
  license: string;
}

const LABELS: Record<ModelType, string> = {
  htdemucs: 'HTDemucs (default)',
  htdemucs_6s: 'HTDemucs 6-stem',
  bs_roformer_sw: 'BS-RoFormer SW',
  melband_roformer_kim: 'MelBand RoFormer (Kim)',
  scnet_small: 'SCNet Small',
  scnet_xl_wide_v5: 'SCNet XL Wide v5',
};

const DESCRIPTIONS: Record<ModelType, string> = {
  htdemucs:
    'Balanced 4-stem separator. Good quality for its size and runs on both WebGPU and CPU.',
  htdemucs_6s:
    'HTDemucs with two extra stems (guitar and piano). Smaller than the 4-stem model.',
  bs_roformer_sw:
    'High-quality RoFormer separator. Large download and needs WebGPU (its memory footprint exceeds the WASM heap).',
  melband_roformer_kim:
    'Vocal-removal specialist: returns the vocal stem plus the instrumental complement (mixture minus vocals). Largest download.',
  scnet_small:
    'Compact SCNet separator. Smallest download of the lineup.',
  scnet_xl_wide_v5:
    'Largest SCNet separator. Needs WebGPU (its memory footprint exceeds the WASM heap).',
};

export const SEPARATION_MODELS: SeparationModelInfo[] = (
  Object.keys(MODEL_ARTIFACTS) as ModelType[]
).map((id) => ({
  id,
  label: LABELS[id] || id,
  description: DESCRIPTIONS[id] || '',
  stems: MODEL_CONFIGS[id].sources,
  sizeBytes: MODEL_ARTIFACTS[id].fp16.sizeBytes,
  webgpuRequired: MODEL_CONFIGS[id].webgpuRequired === true,
  license: MODEL_CONFIGS[id].license,
}));

export function getSeparationModelInfo(id: string): SeparationModelInfo | undefined {
  return SEPARATION_MODELS.find((m) => m.id === id);
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

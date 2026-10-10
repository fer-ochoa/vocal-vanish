// WebGPU vs CPU-WASM acceleration detection for the Config screen and the
// lyricless pipeline.
//
// The check deliberately mirrors unblend's own availability probe
// (separator.js `isWebGPUAvailable`: `navigator.gpu` present + a non-null
// `requestAdapter()`). We do NOT create a GPUDevice just to probe: that is
// heavier, can momentarily occupy the adapter, and unblend never requires a
// device to succeed — the UI status must predict what `Separator.load` will
// actually do, so the criterion has to be the same one unblend applies.
//
// When this reports 'wasm', unblend auto-falls back to its WebAssembly CPU
// backend (except for models flagged `webgpuRequired`, which the pipeline
// rejects up front instead of downloading hundreds of MB that cannot run).

export type AccelerationMode = 'webgpu' | 'wasm';

export interface AccelerationStatus {
  mode: AccelerationMode;
  /** Human-readable adapter label (vendor/device), when exposed by Chromium. */
  adapter?: string;
  /** Why WebGPU is unavailable; shown next to the CPU-fallback message. */
  reason?: string;
}

export async function detectAcceleration(): Promise<AccelerationStatus> {
  const gpu = (navigator as any).gpu;
  if (!gpu) {
    return {
      mode: 'wasm',
      reason: 'This Electron build does not expose navigator.gpu.',
    };
  }

  let adapter: any;
  try {
    adapter = await gpu.requestAdapter();
  } catch (err) {
    return {
      mode: 'wasm',
      reason: `WebGPU adapter request failed: ${(err as Error).message}`,
    };
  }
  if (!adapter) {
    return { mode: 'wasm', reason: 'No usable WebGPU adapter was found.' };
  }

  // Best-effort adapter label. Chromium exposes `adapter.info` (GPUAdapterInfo);
  // older spec drafts used `requestAdapterInfo()`. Never let this break the
  // detection itself.
  try {
    let info = adapter.info;
    if (typeof adapter.requestAdapterInfo === 'function') {
      info = await adapter.requestAdapterInfo();
    }
    if (info) {
      const label = [info.vendor, info.device || info.description]
        .filter(Boolean)
        .join(' ');
      const arch = info.architecture ? ` (${info.architecture})` : '';
      if (label || arch) {
        return { mode: 'webgpu', adapter: `${label}${arch}`.trim() };
      }
    }
  } catch {
    /* adapter info is cosmetic */
  }

  return { mode: 'webgpu' };
}

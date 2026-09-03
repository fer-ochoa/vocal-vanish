<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Config</h1>
      <p class="muted">Separation model and processing backend.</p>
    </header>

    <!-- Separation model ---------------------------------------------------- -->
    <section class="card">
      <h2 class="card-title">Separation model</h2>
      <p class="muted small">
        The model used to remove vocals when generating lyricless versions.
        Each model downloads its weights once on first use, then runs from the local cache.
      </p>

      <label class="field-label" for="model-select">Model</label>
      <select id="model-select" v-model="selectedModel" class="criterion model-select" @change="save()">
        <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>

      <p class="small muted model-desc">{{ selectedInfo.description }}</p>
      <p class="small muted">
        First-run download: {{ fmtBytes(selectedInfo.fp16SizeBytes) }} (fp16)
        <template v-if="selectedInfo.webgpuRequired"> · requires WebGPU</template>
      </p>

      <p v-if="webgpu === false && selectedInfo.webgpuRequired" class="warn">
        ⚠ This model requires WebGPU, which is not available here — it will fail to load.
        Pick a different model or enable GPU acceleration.
      </p>
      <p v-else-if="webgpuF16 === false && selectedInfo.webgpuRequired" class="warn">
        ⚠ This model requires WebGPU with the shader-f16 feature (for fp16 weights),
        but this GPU does not support it. The model will fail to run — pick a different
        model or use a GPU with shader-f16 support.
      </p>
    </section>

    <!-- Processing backend --------------------------------------------------- -->
    <section class="card">
      <h2 class="card-title">Processing backend</h2>
      <p v-if="webgpu === null" class="muted small">Checking for WebGPU…</p>
      <template v-else>
        <div class="backend-row">
          <span class="badge" :class="webgpu ? 'badge-gpu' : 'badge-cpu'">
            {{ webgpu ? 'WebGPU (GPU acceleration)' : 'CPU WebAssembly fallback' }}
          </span>
        </div>
        <p class="small muted">
          <template v-if="webgpu">
            Stem separation will run on your GPU via WebGPU — the fastest option.
          </template>
          <template v-else>
            WebGPU is not available in this Electron browser, so stem separation
            will run on your CPU using ONNX Runtime's WebAssembly backend. This works
            for every model except those marked "requires WebGPU", but it is slower.
          </template>
        </p>
      </template>
    </section>

    <!-- Error toast -->
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ModelType } from 'unblend';
import { DEFAULT_MODEL_ID, SEPARATION_MODELS, getModel } from '../lyricless/models';
import { detectWebGpuF16 } from '../lyricless/stems';

const models = SEPARATION_MODELS;
const selectedModel = ref<string>(DEFAULT_MODEL_ID);
const webgpu = ref<boolean | null>(null); // null = still checking
const webgpuF16 = ref<boolean | null>(null); // null = still checking
const error = ref('');

const selectedInfo = computed(() => getModel(selectedModel.value));

/**
 * Detect whether WebGPU is usable in this renderer. This mirrors unblend's
 * own check (navigator.gpu + requestAdapter) so what we show here matches
 * the backend Separator.load() will actually pick. A full device probe would
 * be more thorough, but unblend only requires an adapter to commit to the
 * WebGPU path — and it still falls back to WASM per-model if session creation
 * fails at load time.
 */
async function detectAcceleration(): Promise<boolean> {
  if (!('gpu' in navigator) || !(navigator as any).gpu) return false;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function save(): Promise<void> {
  error.value = '';
  try {
    await window.kara.setSettings({ separationModel: selectedModel.value });
  } catch (e) {
    error.value = (e as Error).message || 'Failed to save settings';
  }
}

function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

onMounted(async () => {
  // Probe WebGPU availability first, then shader-f16 support (only meaningful
  // when an adapter exists). The f16 probe is cached inside detectWebGpuF16().
  const gpuOk = await detectAcceleration();
  webgpu.value = gpuOk;
  webgpuF16.value = gpuOk ? await detectWebGpuF16() : false;
  try {
    const settings = await window.kara.getSettings();
    if (settings.separationModel && getModel(settings.separationModel)) {
      selectedModel.value = settings.separationModel as ModelType;
    }
  } catch {
    /* first run — keep the default */
  }
});
</script>

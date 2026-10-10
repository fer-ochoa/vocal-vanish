<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Config</h1>
      <p class="muted">Separation model and processing acceleration.</p>
    </header>

    <!-- Separation model -------------------------------------------------- -->
    <section class="card">
      <h2>Separation model</h2>
      <p class="muted small">
        Used to make songs lyricless. The model you pick here is the one used
        for every Lyricless generation from now on.
      </p>

      <div class="config-field">
        <select
          class="criterion"
          v-model="selectedModel"
          :disabled="!models.length"
          @change="saveModel"
        >
          <option
            v-for="m in models"
            :key="m.id"
            :value="m.id"
            :disabled="isDisabled(m)"
          >
            {{ m.label }} — {{ fmtSize(m.sizeBytes) }}{{ isDisabled(m) ? ' (requires WebGPU)' : '' }}
          </option>
        </select>
        <transition name="fade">
          <span v-if="savedNote" class="saved-note">{{ savedNote }}</span>
        </transition>
      </div>

      <dl v-if="selected" class="model-meta">
        <dt>About</dt>
        <dd>{{ selected.description }}</dd>
        <dt>Stems</dt>
        <dd>{{ selected.stems.join(', ') }}</dd>
        <dt>Download</dt>
        <dd>
          {{ fmtSize(selected.sizeBytes) }} (fp16 ONNX, from Hugging Face)
          <template v-if="cacheNote"> — {{ cacheNote }}</template>
        </dd>
        <dt>License</dt>
        <dd>{{ selected.license }}</dd>
      </dl>

      <p v-if="modelWarning" class="warn-note">{{ modelWarning }}</p>
    </section>

    <!-- Acceleration ------------------------------------------------------- -->
    <section class="card">
      <h2>Processing acceleration</h2>
      <div class="accel-row">
        <span class="badge" :class="accelBadgeClass">{{ accelBadgeText }}</span>
        <p class="accel-text">{{ accelMessage }}</p>
        <button class="btn" :disabled="checking" @click="recheck">
          {{ checking ? 'Checking…' : 'Re-check' }}
        </button>
      </div>
      <p v-if="accel && accel.adapter" class="muted small">GPU adapter: {{ accel.adapter }}</p>
      <p v-if="accel && accel.reason" class="muted small">Reason: {{ accel.reason }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { SEPARATION_MODELS, formatBytes } from '../lyricless/models';
import type { SeparationModelInfo } from '../lyricless/models';
import { detectAcceleration } from '../lyricless/accel';
import type { AccelerationStatus } from '../lyricless/accel';

const models = SEPARATION_MODELS;
const selectedModel = ref('htdemucs');
const accel = ref<AccelerationStatus | null>(null);
const checking = ref(false);
const savedNote = ref('');
const cacheNote = ref('');

const selected = computed(
  () => models.find((m) => m.id === selectedModel.value) || models[0],
);

// WebGPU-only models can't run on the CPU fallback, so they're not selectable
// while WebGPU is unavailable.
function isDisabled(m: SeparationModelInfo): boolean {
  return m.webgpuRequired && !!accel.value && accel.value.mode === 'wasm';
}

const modelWarning = computed(() => {
  const m = selected.value;
  if (m && m.webgpuRequired && accel.value && accel.value.mode === 'wasm') {
    return `${m.label} requires WebGPU, which is currently unavailable. Lyricless generation with this model will fail until a GPU adapter is available — pick another model, or fix WebGPU (e.g. update your graphics driver).`;
  }
  return '';
});

const accelBadgeText = computed(() => {
  if (!accel.value) return 'Checking…';
  return accel.value.mode === 'webgpu' ? 'WebGPU' : 'CPU (WebAssembly)';
});

const accelBadgeClass = computed(() => {
  if (!accel.value) return 'badge-dim';
  return accel.value.mode === 'webgpu' ? 'badge-ok' : 'badge-warn';
});

const accelMessage = computed(() => {
  if (!accel.value) return 'Detecting GPU support…';
  if (accel.value.mode === 'webgpu') {
    return 'GPU acceleration enabled — stem separation runs on your GPU via WebGPU.';
  }
  return 'GPU acceleration unavailable — processing will use your CPU (WebAssembly fallback).';
});

function fmtSize(bytes: number): string {
  return formatBytes(bytes);
}

async function refreshCacheNote(): Promise<void> {
  try {
    const status = await window.kara.modelStatus(selectedModel.value);
    cacheNote.value = status.cached
      ? `cached locally (${fmtSize(status.size || 0)})`
      : 'not cached yet — downloads on first use';
  } catch {
    cacheNote.value = '';
  }
}

async function saveModel(): Promise<void> {
  try {
    const settings = await window.kara.setSeparationModel(selectedModel.value);
    selectedModel.value = settings.separationModel;
    savedNote.value = 'Saved';
    setTimeout(() => (savedNote.value = ''), 2000);
    refreshCacheNote();
  } catch (e) {
    savedNote.value = (e as Error).message || 'Failed to save';
  }
}

async function recheck(): Promise<void> {
  checking.value = true;
  try {
    accel.value = await detectAcceleration();
  } finally {
    checking.value = false;
  }
}

onMounted(async () => {
  try {
    const settings = await window.kara.settings();
    selectedModel.value = settings.separationModel;
  } catch {
    /* keep default */
  }
  refreshCacheNote();
  accel.value = await detectAcceleration();
});
</script>

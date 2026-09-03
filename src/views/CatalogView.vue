<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Catalog</h1>
      <p class="muted">Your locally downloaded hardsubbed songs.</p>
    </header>

    <div class="searchbar">
      <input v-model.trim="filter" class="input" placeholder="Filter by title, series or singer…" spellcheck="false" />
      <span class="muted small">{{ shown.length }} song{{ shown.length === 1 ? '' : 's' }}</span>
    </div>

    <ul v-if="shown.length" class="list">
      <li v-for="entry in shown" :key="entry.kid" class="row">
        <div class="row-main">
          <div class="row-title">{{ entry.title }}</div>
          <div class="row-sub">
            <span v-if="entry.series" class="tag">{{ entry.series }}</span>
            <span v-if="entry.singer" class="tag tag-dim">{{ entry.singer }}</span>
            <span v-if="entry.duration" class="dur">{{ fmtDuration(entry.duration) }}</span>
            <span v-if="entry.lyriclessFile" class="tag tag-accent">Lyricless</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-primary" @click="play(entry.kid)">Play</button>
          <button
            class="btn"
            :disabled="processing !== null"
            :title="entry.lyriclessFile ? 'Regenerate lyricless version' : 'Generate lyricless version'"
            @click="startLyricless(entry)"
          >
            Lyricless
          </button>
          <button class="btn btn-ghost" title="Delete" @click="remove(entry.kid)">✕</button>
        </div>
      </li>
    </ul>
    <p v-else-if="loaded" class="muted">Nothing here yet. Download some songs from the Search screen.</p>

    <!-- Lyricless progress overlay -->
    <transition name="fade">
      <div v-if="processing !== null" class="overlay">
        <div class="dialog">
          <h2>Generating lyricless…</h2>
          <p class="muted">{{ processTitle }}</p>
          <div class="bar"><div class="bar-fill" :style="{ width: processPct + '%' }" /></div>
          <p class="small muted">{{ processLabel }}</p>
        </div>
      </div>
    </transition>

    <!-- Error toast -->
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { generateLyricless } from '../lyricless/pipeline';

const router = useRouter();
const entries = ref<any[]>([]);
const filter = ref('');
const loaded = ref(false);
const error = ref('');

// --- Lyricless generation state -------------------------------------------
const processing = ref<string | null>(null); // kid being processed, or null
const processTitle = ref('');
const processLabel = ref('');
const processPct = ref(0);

async function load(): Promise<void> {
  try {
    entries.value = await window.kara.catalog();
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load catalog';
  }
}

const shown = computed(() => {
  const f = filter.value.toLowerCase();
  if (!f) return entries.value;
  return entries.value.filter(
    (e) =>
      e.title.toLowerCase().includes(f) ||
      e.series.toLowerCase().includes(f) ||
      e.singer.toLowerCase().includes(f),
  );
});

function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}

async function remove(kid: string): Promise<void> {
  if (!window.confirm('Delete this song from your catalog?')) return;
  try {
    await window.kara.delete(kid);
    entries.value = entries.value.filter((e) => e.kid !== kid);
  } catch (e) {
    error.value = (e as Error).message || 'Delete failed';
  }
}

async function startLyricless(entry: any): Promise<void> {
  if (processing.value !== null) return; // already processing
  processing.value = entry.kid;
  processTitle.value = entry.title;
  processLabel.value = 'Starting…';
  processPct.value = 0;
  error.value = '';

  try {
    // Read the model selected on the Config screen before showing the
    // overlay, so a missing/invalid setting never strands the UI.
    let modelId: string | undefined;
    try {
      const settings = await window.kara.getSettings();
      modelId = settings.separationModel;
    } catch {
      /* fall back to the pipeline default (htdemucs) */
    }

    // Stream the original video bytes from the main process.
    const buf = await window.kara.openMediaStream(entry.kid);

    // Run the full pipeline: decode → separate → re-mux.
    const lyriclessBytes = await generateLyricless(buf, (p) => {
      processLabel.value = p.label;
      // Map stage fractions to an overall 0-100% range.
      const stageWeight = p.stage === 'decode' ? 0.1 : p.stage === 'separate' ? 0.7 : 0.2;
      const stageStart = p.stage === 'decode' ? 0 : p.stage === 'separate' ? 10 : 80;
      processPct.value = Math.round(stageStart + p.fraction * stageWeight * 100);
    }, modelId as any);

    // Write the result to disk via IPC.
    await window.kara.writeLyricless(entry.kid, lyriclessBytes);

    // Update the local entry.
    const idx = entries.value.findIndex((e) => e.kid === entry.kid);
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], lyriclessFile: `${entry.kid}.lyricless.mp4` };
    }
  } catch (e) {
    error.value = (e as Error).message || 'Lyricless generation failed';
  } finally {
    processing.value = null;
  }
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

onMounted(load);
</script>

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
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-primary" @click="play(entry.kid)">Play</button>
          <button class="btn btn-ghost" title="Delete" @click="remove(entry.kid)">✕</button>
        </div>
      </li>
    </ul>
    <p v-else-if="loaded" class="muted">Nothing here yet. Download some songs from the Search screen.</p>

    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const entries = ref<any[]>([]);
const filter = ref('');
const loaded = ref(false);
const error = ref('');

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

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

onMounted(load);
</script>

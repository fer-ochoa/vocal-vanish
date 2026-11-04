<template>
  <div class="screen">
    <header class="screen-head">
      <h1>{{ collection ? collection.name : 'Collection' }}</h1>
      <p class="muted">
        <span class="tag" :class="sourceBadgeClass(collection ? collection.source : 'local')">{{ collection ? collection.source : '…' }}</span>
        <span class="muted small">{{ songs.length }} song{{ songs.length === 1 ? '' : 's' }}</span>
      </p>
    </header>
    <ul v-if="songs.length" class="list">
      <li v-for="(entry, idx) in songs" :key="entry.kid" class="row">
        <div class="row-main">
          <div class="row-title">{{ entry.title }}</div>
          <div class="row-sub">
            <span v-if="entry.series" class="tag">{{ entry.series }}</span>
            <span v-if="entry.singer" class="tag tag-dim">{{ entry.singer }}</span>
            <span v-for="lang in entry.langs || []" :key="lang" class="tag tag-lang" title="Song language">{{ lang }}</span>
            <span v-if="entry.offVocal" class="tag tag-offvocal" title="This version is already instrumental">Off Vocal</span>
            <span v-if="entry.duration" class="dur">{{ fmtDuration(entry.duration) }}</span>
            <span v-if="entry.lyriclessFile" class="tag tag-accent">Lyricless</span>
          </div>
        </div>
        <div class="row-actions">
          <button
            class="btn"
            :class="playButtonClass(entry)"
            :title="playButtonTitle(entry)"
            @click="play(entry.kid)"
          >
            Play
          </button>
          <button
            class="btn btn-ghost"
            title="Move up"
            :disabled="idx === 0 || busy"
            @click="moveUp(idx)"
          >
            ↑
          </button>
          <button
            class="btn btn-ghost"
            title="Move down"
            :disabled="idx === songs.length - 1 || busy"
            @click="moveDown(idx)"
          >
            ↓
          </button>
          <button
            class="btn btn-ghost"
            title="Remove from collection"
            :disabled="busy"
            @click="removeSong(entry.kid)"
          >
            ✕
          </button>
        </div>
      </li>
    </ul>
    <p v-else-if="loaded" class="muted">No songs in this collection yet.</p>
    <!-- Error toast -->
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();
const collectionId = route.params.id as string;
const collection = ref<any>(null);
const songs = ref<any[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
async function load(): Promise<void> {
  try {
    // Load collection metadata
    const cols = await window.kara.collectionsList();
    collection.value = cols.find((c: any) => c.id === collectionId) || null;
    // Load songs in order
    songs.value = await window.kara.collectionSongs(collectionId);
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load collection';
  }
}
function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}
async function removeSong(kid: string): Promise<void> {
  if (!window.confirm('Remove this song from the collection? The song itself will not be deleted.')) return;
  busy.value = true;
  error.value = '';
  try {
    await window.kara.collectionRemoveSong(collectionId, kid);
    songs.value = songs.value.filter((e) => e.kid !== kid);
  } catch (e) {
    error.value = (e as Error).message || 'Failed to remove song';
  } finally {
    busy.value = false;
  }
}
async function moveUp(idx: number): Promise<void> {
  if (idx === 0) return;
  busy.value = true;
  error.value = '';
  try {
    const ordered = [...songs.value];
    [ordered[idx - 1], ordered[idx]] = [ordered[idx], ordered[idx - 1]];
    await window.kara.collectionReorder(collectionId, ordered.map((e) => e.kid));
    songs.value = ordered;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to reorder';
  } finally {
    busy.value = false;
  }
}
async function moveDown(idx: number): Promise<void> {
  if (idx === songs.value.length - 1) return;
  busy.value = true;
  error.value = '';
  try {
    const ordered = [...songs.value];
    [ordered[idx], ordered[idx + 1]] = [ordered[idx + 1], ordered[idx]];
    await window.kara.collectionReorder(collectionId, ordered.map((e) => e.kid));
    songs.value = ordered;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to reorder';
  } finally {
    busy.value = false;
  }
}
// --- Helpers ---------------------------------------------------------------
function sourceBadgeClass(source: string): string {
  if (source === 'local') return 'tag-accent';
  if (source === 'remote-own') return 'tag-lang';
  return 'tag-dim';
}
function playButtonClass(entry: any): string {
  if (entry.offVocal) return 'btn-offvocal';
  if (entry.lyriclessFile) return 'btn-primary';
  return '';
}
function playButtonTitle(entry: any): string {
  if (entry.offVocal) return 'Play (off vocal version)';
  if (entry.lyriclessFile) return 'Play (lyricless version available)';
  return 'Play';
}
function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
onMounted(load);
// Reload if the route param changes (e.g. navigating between collections)
watch(() => route.params.id, (newId) => {
  if (newId && newId !== collectionId) {
    // Re-navigate to the new collection
    router.replace({ name: 'collection-detail', params: { id: newId } });
  }
});
</script>

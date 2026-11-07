<template>
  <div class="screen">
    <header class="screen-head">
      <button class="btn btn-ghost back-link" title="Back to collections" @click="goBack">← Collections</button>
      <h1>{{ collection ? collection.name : 'Collection' }}</h1>
      <p class="muted">
        <span class="tag" :class="sourceBadgeClass(collection ? collection.source : 'local')">{{ collection ? collection.source : '…' }}</span>
        <span v-if="isImported" class="muted small">{{ downloadedCount }} of {{ songs.length }} downloaded</span>
        <span v-else class="muted small">{{ songs.length }} song{{ songs.length === 1 ? '' : 's' }}</span>
        <span v-if="isImported && collection?.ownerUsername" class="muted small">by {{ collection.ownerUsername }}</span>
        <span v-if="isImported && collection?.lastSyncedAt" class="muted small">{{ syncedAgo(collection.lastSyncedAt) }}</span>
      </p>
      <button
        v-if="isImported"
        class="btn btn-primary"
        :disabled="bulkBusy || missingCount === 0"
        @click="downloadAllMissing"
      >
        Download all missing ({{ missingCount }})
      </button>
      <button
        v-if="isImported"
        class="btn"
        :disabled="syncing"
        @click="syncNow"
      >
        {{ syncing ? 'Syncing…' : 'Sync' }}
      </button>
    </header>
    <!-- Stale banner -->
    <div v-if="isImported && stale" class="stale-banner">
      This playlist is no longer available on kara.moe — showing the last synced copy.
    </div>
    <!-- Local collections -->
    <ul v-if="!isImported && songs.length" class="list">
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
    <!-- Imported collections -->
    <ul v-if="isImported && songs.length" class="list">
      <li v-for="(entry, idx) in songs" :key="entry.kid" class="row">
        <div class="row-main">
          <div class="row-title">{{ entry.title }}</div>
          <div class="row-sub">
            <span class="muted small">{{ idx + 1 }}.</span>
            <span v-if="entry.series" class="tag">{{ entry.series }}</span>
            <span v-if="entry.singer" class="tag tag-dim">{{ entry.singer }}</span>
            <span v-if="entry.duration != null" class="dur">{{ fmtDuration(entry.duration) }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button
            v-if="entry.downloaded"
            class="btn"
            :class="playButtonClass(entry)"
            :title="playButtonTitle(entry)"
            @click="play(entry.kid)"
          >
            Play
          </button>
          <template v-else>
            <span class="tag tag-dim">Not Downloaded</span>
            <button
              class="btn"
              :disabled="downloadingKid !== null"
              @click="downloadOne(entry.kid)"
            >
              {{ downloadingKid === entry.kid ? 'Downloading…' : 'Download' }}
            </button>
          </template>
        </div>
      </li>
    </ul>
    <!-- Empty states -->
    <p v-if="loaded && isImported && !songs.length" class="muted">{{ stale ? 'This playlist is no longer available on kara.moe. Its last synced copy is shown above.' : 'This playlist is empty.' }}</p>
    <p v-if="loaded && !isImported && !songs.length" class="muted">No songs in this collection yet.</p>
    <!-- Bulk download progress overlay -->
    <transition name="fade">
      <div v-if="bulkBusy || bulkSummary" class="overlay">
        <div class="dialog">
          <h2 v-if="bulkBusy">Downloading {{ bulkDone }} / {{ bulkTotal }}</h2>
          <h2 v-else>Download complete</h2>
          <p v-if="bulkBusy" class="muted small">
            {{ bulkDone }} of {{ bulkTotal }} done
          </p>
          <div v-if="bulkBusy" class="bulk-bars">
            <div v-for="item in bulkInFlightList" :key="item.kid" class="bulk-bar">
              <div class="row-title small">{{ bulkTitle(item.kid) }}</div>
              <div class="bar"><div class="bar-fill" :style="{ width: bulkPct(item) + '%' }" /></div>
              <p class="small muted">{{ bulkLabel(item) }}</p>
            </div>
            <p v-if="!bulkInFlightList.length" class="muted small">Waiting for next song…</p>
          </div>
          <template v-else>
            <p class="muted">
              {{ bulkSummary.downloaded }} downloaded, {{ bulkSummary.skipped }} skipped, {{ bulkSummary.failed.length }} failed
            </p>
            <ul v-if="bulkSummary.failed.length" class="list bulk-failed">
              <li v-for="f in bulkSummary.failed" :key="f.kid" class="row">
                <div class="row-main">
                  <div class="row-title">{{ bulkTitle(f.kid) }}</div>
                  <div class="row-sub">
                    <span class="muted small">{{ f.kid }}</span>
                  </div>
                </div>
                <div class="row-actions">
                  <span class="muted small">{{ f.error }}</span>
                </div>
              </li>
            </ul>
            <button class="btn btn-primary" @click="closeBulkSummary">Close</button>
          </template>
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
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();
const collectionId = route.params.id as string;
const tabFrom = computed(() => {
  const t = String(route.query.from ?? '');
  return t === 'public' || t === 'mine' || t === 'imported' ? t : 'local';
});
function goBack(): void {
  router.push({ name: 'collections', query: { tab: tabFrom.value } });
}
const collection = ref<any>(null);
const songs = ref<any[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
const isImported = computed(() => collection.value?.source === 'imported');
const stale = ref(false);
const syncing = ref(false);
const downloadingKid = ref<string | null>(null);
const downloadedCount = computed(() => songs.value.filter((s: any) => s.downloaded).length);
// Songs in the collection not yet downloaded locally.
const missingCount = computed(() =>
  isImported.value ? songs.value.filter((s: any) => !s.downloaded).length : 0
);
async function load(): Promise<void> {
  try {
    const cols = await window.kara.collectionsList();
    collection.value = cols.find((c: any) => c.id === collectionId) || null;
    songs.value = await window.kara.collectionSongs(collectionId);
    stale.value = collection.value?.remoteStale === true;
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load collection';
  }
}
function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}
async function removeSong(kid: string): Promise<void> {
  if (isImported.value) return;
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
  if (isImported.value) return;
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
  if (isImported.value) return;
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
// --- Single-song download (imported) ---------------------------------------
async function downloadOne(kid: string): Promise<void> {
  if (downloadingKid.value) return;
  downloadingKid.value = kid;
  error.value = '';
  try {
    await window.kara.collectionDownloadSong(collectionId, kid);
    songs.value = await window.kara.collectionSongs(collectionId);
  } catch (e) {
    error.value = (e as Error).message || 'Download failed';
  } finally {
    downloadingKid.value = null;
  }
}
// --- Bulk download (imported) ----------------------------------------------
const bulkBusy = ref(false);
const bulkTotal = ref(0);
const bulkDone = ref(0);
const bulkInFlight = ref<Record<string, { kid: string; received: number; total: number | null }>>({});
const bulkSummary = ref<{ downloaded: number; skipped: number; failed: { kid: string; error: string }[] } | null>(null);
let offBulkProgress: (() => void) | null = null;
let offBulkBytes: (() => void) | null = null;
const bulkInFlightList = computed(() => Object.values(bulkInFlight.value));
function bulkTitle(kid: string): string {
  return songs.value.find((s: any) => s.kid === kid)?.title || kid;
}
function bulkPct(item: { received: number; total: number | null }): number {
  if (!item.total) return 0;
  return Math.min(100, Math.round((item.received / item.total) * 100));
}
function bulkLabel(item: { received: number; total: number | null }): string {
  if (!item.total) return '…';
  return `${Math.round((item.received / item.total) * 100)}%`;
}
async function downloadAllMissing(): Promise<void> {
  if (bulkBusy.value || missingCount.value === 0) return;
  bulkBusy.value = true;
  bulkSummary.value = null;
  bulkTotal.value = 0;
  bulkDone.value = 0;
  bulkInFlight.value = {};
  error.value = '';
  offBulkProgress = window.kara.onCollectionDownloadProgress((p) => {
    if (p.collectionId !== collectionId) return;
    bulkTotal.value = p.total;
    bulkDone.value = p.completed;
    if (p.status === 'start') {
      bulkInFlight.value[p.kid] = { kid: p.kid, received: 0, total: null };
    } else if (p.status === 'done' || p.status === 'failed') {
      delete bulkInFlight.value[p.kid];
    }
  });
  offBulkBytes = window.kara.onDownloadProgress((p) => {
    const item = bulkInFlight.value[p.kid];
    if (!item) return;
    item.received = p.received;
    if (p.total) item.total = p.total;
  });
  try {
    const summary = await window.kara.collectionDownload(collectionId);
    bulkSummary.value = summary;
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Bulk download failed';
  } finally {
    offBulkProgress?.();
    offBulkBytes?.();
    offBulkProgress = null;
    offBulkBytes = null;
    bulkBusy.value = false;
  }
}
function closeBulkSummary(): void {
  bulkSummary.value = null;
}
// --- Sync imported collection ----------------------------------------------
async function syncNow(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  error.value = '';
  try {
    const result = await window.kara.collectionSyncImported(collectionId);
    stale.value = result.stale;
    // Refresh the collection row to pick up updated lastSyncedAt
    const cols = await window.kara.collectionsList();
    collection.value = cols.find((c: any) => c.id === collectionId) || collection.value;
    // Reload songs
    songs.value = await window.kara.collectionSongs(collectionId);
  } catch (e) {
    error.value = (e as Error).message || 'Failed to sync playlist';
  } finally {
    syncing.value = false;
  }
}
// --- Helpers ---------------------------------------------------------------
function sourceBadgeClass(source: string): string {
  if (source === 'local') return 'tag-accent';
  if (source === 'imported') return 'tag-lang';
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
function syncedAgo(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'synced just now';
  if (diff < 3_600_000) return `synced ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `synced ${Math.floor(diff / 3_600_000)}h ago`;
  return `synced on ${iso.slice(0, 10)}`;
}
onMounted(load);
// Reload if the route param changes (e.g. navigating between collections)
watch(() => route.params.id, (newId) => {
  if (newId && newId !== collectionId) {
    // Re-navigate to the new collection, preserving the query string
    // (e.g. the `from` tab hint) so it survives import/sync re-navigation.
    router.replace({ name: 'collection-detail', params: { id: newId }, query: { ...route.query } });
  }
});
</script>
<style scoped>
.back-link {
  padding: 4px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  align-self: flex-start;
}
</style>

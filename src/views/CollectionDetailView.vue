<template>
  <div class="screen">
    <header class="screen-head">
      <button class="btn btn-ghost back-link" title="Back to collections" @click="goBack">← Collections</button>
      <h1>{{ collection ? collection.name : 'Collection' }}</h1>
      <p class="muted">
        <span class="tag" :class="sourceBadgeClass(collection ? collection.source : 'local')">{{ collection ? collection.source : '…' }}</span>
        <span v-if="isRemote" class="muted small">{{ downloadedCount }} of {{ rows.length }} downloaded</span>
        <span v-else class="muted small">{{ songs.length }} song{{ songs.length === 1 ? '' : 's' }}</span>
        <span v-if="isSubscribed && collection?.ownerUsername" class="muted small">by {{ collection.ownerUsername }}</span>
        <span v-if="isSubscribed && collection?.lastSyncedAt" class="muted small">{{ syncedAgo(collection.lastSyncedAt) }}</span>
      </p>
      <button
        v-if="isRemote"
        class="btn btn-primary"
        :disabled="bulkBusy || missingCount === 0"
        @click="downloadAllMissing"
      >
        Download all missing ({{ missingCount }})
      </button>
      <button
        v-if="isSubscribed"
        class="btn"
        :disabled="syncing"
        @click="syncNow"
      >
        {{ syncing ? 'Syncing…' : 'Sync now' }}
      </button>
    </header>
    <!-- Stale banner (feat 08) -->
    <div v-if="stale" class="stale-banner">
      This playlist is no longer public on kara.moe — showing the last synced copy.
    </div>
    <!-- Local collections -->
    <ul v-if="!isRemote && songs.length" class="list">
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
    <!-- Remote-own collections (read-only snapshot) -->
    <ul v-if="isRemote && rows.length" class="list">
      <li v-for="row in rows" :key="row.kid" class="row">
        <div class="row-main">
          <div class="row-title">{{ row.title }}</div>
          <div class="row-sub">
            <span class="muted small">{{ row.position }}.</span>
            <span v-if="row.series" class="tag">{{ row.series }}</span>
            <span v-if="row.singer" class="tag tag-dim">{{ row.singer }}</span>
            <span v-if="row.duration != null" class="dur">{{ fmtDuration(row.duration) }}</span>
            <span v-if="row.downloaded" class="tag tag-accent">Downloaded</span>
            <span v-else class="tag tag-dim">Not downloaded</span>
          </div>
        </div>
        <div class="row-actions">
          <button
            class="btn"
            :disabled="!row.downloaded"
            :title="row.downloaded ? 'Play' : 'Not downloaded yet'"
            @click="play(row.kid)"
          >
            Play
          </button>
        </div>
      </li>
    </ul>
    <!-- Empty states -->
    <p v-if="loaded && isRemote && !rows.length" class="muted">{{ stale ? 'This playlist is no longer public on kara.moe, and no copy of its contents was saved.' : 'This playlist is empty on kara.moe.' }}</p>
    <p v-if="loaded && !isRemote && !songs.length" class="muted">No songs in this collection yet.</p>
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
  return t === 'public' || t === 'mine' ? t : 'local';
});
function goBack(): void {
  router.push({ name: 'collections', query: { tab: tabFrom.value } });
}
const collection = ref<any>(null);
const songs = ref<any[]>([]);
const rows = ref<any[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
const isRemote = computed(() =>
  collection.value?.source === 'remote-own' || collection.value?.source === 'remote-subscribed'
);
const isSubscribed = computed(() => collection.value?.source === 'remote-subscribed');
const stale = ref(false);
const syncing = ref(false);
const downloadedCount = computed(() => rows.value.filter((r: any) => r.downloaded).length);
// Songs in the collection not yet in the local library. Local collections can
// only contain already-downloaded songs, so only remote-own can have a gap.
const missingCount = computed(() =>
  isRemote.value ? rows.value.filter((r: any) => !r.downloaded).length : 0
);
async function load(): Promise<void> {
  try {
    // Load collection metadata
    const cols = await window.kara.collectionsList();
    collection.value = cols.find((c: any) => c.id === collectionId) || null;
    // Load songs in order
    if (collection.value && (collection.value.source === 'remote-own' || collection.value.source === 'remote-subscribed')) {
      rows.value = await window.kara.collectionRemoteItems(collectionId);
      // Show stale banner on load if the row is already marked stale
      stale.value = collection.value.remoteStale === true;
    } else {
      songs.value = await window.kara.collectionSongs(collectionId);
    }
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load collection';
  }
}
function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}
async function removeSong(kid: string): Promise<void> {
  if (isRemote.value) return;
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
  if (isRemote.value) return;
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
  if (isRemote.value) return;
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
// --- Bulk download (feat 07) ----------------------------------------------
const bulkBusy = ref(false);
const bulkTotal = ref(0);
const bulkDone = ref(0);
const bulkInFlight = ref<Record<string, { kid: string; received: number; total: number | null }>>({});
const bulkSummary = ref<{ downloaded: number; skipped: number; failed: { kid: string; error: string }[] } | null>(null);
let offBulkProgress: (() => void) | null = null;
let offBulkBytes: (() => void) | null = null;
const bulkInFlightList = computed(() => Object.values(bulkInFlight.value));
function bulkTitle(kid: string): string {
  return rows.value.find((r: any) => r.kid === kid)?.title || kid;
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
// --- Sync subscribed collection (feat 08) ----------------------------------
async function syncNow(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  error.value = '';
  try {
    const result = await window.kara.collectionSyncSubscribed(collectionId);
    rows.value = result.items;
    stale.value = result.stale;
    // Refresh the collection row to pick up updated lastSyncedAt
    const cols = await window.kara.collectionsList();
    collection.value = cols.find((c: any) => c.id === collectionId) || collection.value;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to sync playlist';
  } finally {
    syncing.value = false;
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
    // (e.g. the `from` tab hint) so it survives subscribe/sync re-navigation.
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

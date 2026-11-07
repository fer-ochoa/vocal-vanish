<template>
  <div class="mine-collections-panel coll-panel">
    <!-- Sync toolbar -->
    <div class="new-collection">
      <select v-model="order" class="input input-sm" @change="refreshList">
        <option value="az">A–Z</option>
        <option value="recent">Most recent</option>
        <option value="karacount">Most songs</option>
        <option value="duration">Longest</option>
        <option value="username">Owner</option>
      </select>
      <input
        v-model.trim="filter"
        class="input input-sm"
        placeholder="Filter playlists…"
        spellcheck="false"
        @keyup.enter="refreshList"
      />
      <button class="btn btn-primary" :disabled="refreshing" @click="refreshList">
        {{ refreshing ? 'Refreshing…' : 'Refresh list' }}
      </button>
      <span v-if="lastSyncedLabel" class="muted small">{{ lastSyncedLabel }}</span>
    </div>
    <p v-if="!loggedIn" class="muted">Log in on the Config screen to see your kara.moe playlists.</p>
    <!-- Fetched playlists -->
    <PagedList
      v-if="playlists.length"
      :items="playlists"
      :reset-key="filter + '|' + order"
      :class="{ 'list-section--grow': !importedOwn.length }"
      v-slot="{ paged }"
    >
      <ul class="list">
        <li v-for="pl in paged" :key="pl.plaid" class="row">
          <div class="row-main">
            <div class="row-title">{{ pl.name }}</div>
            <div class="row-sub">
              <span class="muted small">{{ pl.karacount ?? 0 }} songs</span>
              <span class="muted small">by {{ pl.nickname || pl.username }}</span>
            </div>
          </div>
          <div class="row-actions">
            <button
              class="btn btn-ghost"
              :disabled="isImported(pl) || importingPlaid === pl.plaid"
              @click.stop="importPlaylist(pl)"
            >
              {{ importingPlaid === pl.plaid ? '…' : isImported(pl) ? 'Imported ✓' : 'Import' }}
            </button>
            <span v-if="importError[pl.plaid]" class="browse-row-error">{{ importError[pl.plaid] }}</span>
          </div>
        </li>
      </ul>
    </PagedList>
    <p v-else-if="loggedIn && !refreshing" class="muted">No kara.moe playlists found.</p>
    <!-- Already-imported own collections -->
    <h2 v-if="importedOwn.length" style="font-size: 15px; margin: 14px 0 10px;">Imported</h2>
    <PagedList
      v-if="importedOwn.length"
      :items="importedOwn"
      class="list-section--grow"
      v-slot="{ paged }"
    >
      <ul class="list">
        <li
          v-for="col in paged"
          :key="col.id"
          class="row"
          @click="emit('open', col.id)"
        >
          <div class="row-main">
            <div class="row-title">{{ col.name }}</div>
            <div class="row-sub">
              <span class="muted small">{{ col.downloadedCount }} of {{ col.songCount }} downloaded</span>
              <span v-if="col.lastSyncedAt" class="muted small">{{ syncedAgo(col.lastSyncedAt) }}</span>
              <span v-if="col.remoteStale === true" class="tag tag-dim" title="This playlist is no longer public on kara.moe">no longer public</span>
            </div>
          </div>
        </li>
      </ul>
    </PagedList>
  </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import PagedList from '../PagedList.vue';
import type { RemotePlaylist, PlaylistOrder } from '../../preload';

const props = defineProps<{
  collections: any[];
  loggedIn: boolean;
  username: string;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'open', id: string): void;
  (e: 'error', message: string): void;
}>();

// --- Sync toolbar ----------------------------------------------------------
const refreshing = ref(false);
const order = ref<PlaylistOrder>('az');
const filter = ref('');
const playlists = ref<RemotePlaylist[]>([]);
const importingPlaid = ref<string | null>(null);
const importError = ref<Record<string, string>>({});
async function refreshList(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    playlists.value = await window.kara.playlistsMine({
      filter: filter.value || undefined,
      order: order.value,
    });
  } catch (e) {
    emit('error', (e as Error).message || 'Failed to fetch playlists');
  } finally {
    refreshing.value = false;
  }
}
function isImported(pl: RemotePlaylist): boolean {
  return props.collections.some((c: any) => c.remotePlaid === pl.plaid);
}
async function importPlaylist(pl: RemotePlaylist): Promise<void> {
  if (importingPlaid.value || isImported(pl)) return;
  importingPlaid.value = pl.plaid;
  const errKey = pl.plaid;
  delete importError.value[errKey];
  try {
    await window.kara.collectionImport({
      plaid: pl.plaid,
      name: pl.name,
      ownerUsername: pl.username ?? null,
      origin: 'own',
    });
    emit('refresh');
  } catch (e) {
    importError.value = { ...importError.value, [errKey]: (e as Error).message || 'Failed to import' };
  } finally {
    importingPlaid.value = null;
  }
}
const importedOwn = computed(() =>
  props.collections.filter((c: any) => c.source === 'imported' && c.origin === 'own'),
);
const lastSyncedLabel = computed(() => {
  const times = importedOwn.value
    .filter((c: any) => c.lastSyncedAt)
    .map((c: any) => new Date(c.lastSyncedAt).getTime())
    .filter((t: number) => !isNaN(t));
  if (!times.length) return '';
  const latest = Math.max(...times);
  return syncedAgo(new Date(latest).toISOString());
});



// --- Helpers ---------------------------------------------------------------
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
</script>

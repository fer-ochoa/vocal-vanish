<template>
  <div class="mine-collections-panel">
    <!-- Sync toolbar -->
    <div class="new-collection">
      <select v-model="order" class="input input-sm" @change="syncNow">
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
        @keyup.enter="syncNow"
      />
      <button class="btn btn-primary" :disabled="syncing" @click="syncNow">
        {{ syncing ? 'Syncing…' : 'Sync now' }}
      </button>
      <span v-if="lastSyncedLabel" class="muted small">{{ lastSyncedLabel }}</span>
    </div>
    <!-- remote-own rows -->
    <ul v-if="collections.length" class="list">
      <li
        v-for="col in collections"
        :key="col.id"
        class="row"
        @click="emit('open', col.id)"
      >
        <div class="row-main">
          <div class="row-title">{{ col.name }}</div>
          <div class="row-sub">
            <span class="muted small">{{ col.songCount }} of {{ col.remoteItemCount ?? col.songCount }} downloaded</span>
            <span v-if="col.ownerUsername && col.ownerUsername !== username" class="muted small">by {{ col.ownerUsername }}</span>
            <span v-if="col.lastSyncedAt" class="muted small">{{ syncedAgo(col.lastSyncedAt) }}</span>
            <span v-if="col.remoteStale === true" class="tag tag-dim" title="This playlist is no longer public on kara.moe">no longer public</span>
          </div>
        </div>
      </li>
    </ul>
    <p v-else-if="!loggedIn" class="muted">Log in on the Config screen to see your kara.moe playlists.</p>
    <p v-else class="muted">No kara.moe playlists yet — press “Sync now”.</p>
  </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';

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
const syncing = ref(false);
const order = ref<'az' | 'recent' | 'karacount' | 'duration' | 'username'>('az');
const filter = ref('');
async function syncNow(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await window.kara.collectionSyncRemoteOwn({
      filter: filter.value,
      order: order.value,
    });
    emit('refresh');
  } catch (e) {
    emit('error', (e as Error).message || 'Failed to sync playlists');
  } finally {
    syncing.value = false;
  }
}

/** "Synced 3m ago" across all remote-own rows; '' when none. */
const lastSyncedLabel = computed(() => {
  const times = props.collections
    .filter((c: any) => c.source === 'remote-own' && c.lastSyncedAt)
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
<style scoped>
.mine-collections-panel {
  display: block;
}
</style>

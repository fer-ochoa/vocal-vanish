<template>
  <div class="imported-collections-panel coll-panel">
    <PagedList
      v-if="collections.length"
      :items="collections"
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
              <span class="tag" :class="col.origin === 'own' ? 'tag-accent' : 'tag-dim'">
                {{ col.origin === 'own' ? 'yours' : 'public' }}
              </span>
              <span class="muted small">{{ col.downloadedCount }} of {{ col.songCount }} downloaded</span>
              <span v-if="col.ownerUsername" class="muted small">by {{ col.ownerUsername }}</span>
              <span v-if="col.lastSyncedAt" class="muted small">{{ syncedAgo(col.lastSyncedAt) }}</span>
              <span v-if="col.remoteStale === true" class="tag tag-dim">no longer public</span>
            </div>
          </div>
          <div class="row-actions">
            <button
              class="btn btn-ghost"
              title="Delete"
              @click.stop="emit('remove', col.id, col.name)"
            >
              ✕
            </button>
          </div>
        </li>
      </ul>
    </PagedList>
    <p v-else-if="loaded" class="muted">No imported collections yet — import one from the Public or Mine tab.</p>
  </div>
</template>
<script setup lang="ts">
import PagedList from '../PagedList.vue';
const props = defineProps<{
  collections: any[];
  loaded: boolean;
}>();
const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'open', id: string): void;
  (e: 'remove', id: string, name: string): void;
  (e: 'error', message: string): void;
}>();
void props;
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

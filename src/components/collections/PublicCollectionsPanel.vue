<template>
  <div class="public-collections-panel coll-panel">
    <!-- Imported from public playlists -->
    <h2 style="font-size: 15px; margin: 0 0 10px;">Imported from public playlists</h2>
    <PagedList
      v-if="importedCollections.length"
      :items="importedCollections"
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
              <span v-if="col.ownerUsername" class="muted small">by {{ col.ownerUsername }}</span>
              <span class="muted small">{{ col.songCount }} of {{ col.remoteItemCount ?? col.songCount }} downloaded</span>
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
    <p v-else class="muted">No public playlists imported yet — browse a kara.moe user below.</p>
    <!-- Browse a kara.moe user (feat 08) — public data, works logged out -->
    <details class="browse-panel" open>
      <summary class="browse-summary">Browse a kara.moe user</summary>
      <div class="browse-controls">
        <input
          v-model.trim="browseUsername"
          class="input input-sm"
          placeholder="Username…"
          spellcheck="false"
          @keyup.enter="browseUser()"
        />
        <button class="btn btn-primary" :disabled="!browseUsername || browsing" @click="browseUser()">
          {{ browsing ? 'Browsing…' : 'Browse' }}
        </button>
        <input
          v-model.trim="browseFilter"
          class="input input-sm"
          placeholder="Filter…"
          spellcheck="false"
        />
        <select v-model="browseOrder" class="input input-sm" title="Sort order">
          <option value="az">Name (A–Z)</option>
          <option value="recent">Recently created</option>
          <option value="karacount">Most songs</option>
          <option value="duration">Longest</option>
          <option value="username">Owner</option>
        </select>
        <button class="btn" :disabled="!hasBrowsed || browsing" @click="refreshBrowse">
          Refresh
        </button>
        <label class="browse-check">
          <input v-model="browseIncludeContributions" type="checkbox" />
          Include playlists they contribute to
        </label>
      </div>
      <!-- Browse results -->
      <div v-if="browsing" class="muted small browse-state">Browsing…</div>
      <div v-else-if="browseError" class="browse-state browse-error">{{ browseError }}</div>
      <div v-else-if="hasBrowsed && !browseResults.length" class="muted small browse-state">
        No public playlists for {{ browseUsername }}.
      </div>
        <PagedList
          v-else-if="browseResults.length"
          :items="browseResults"
          :reset-key="`${browseFilter}|${browseOrder}|${browseIncludeContributions}`"
          class="list-section--grow browse-list"
          v-slot="{ paged }"
        >
          <ul class="list">
            <li v-for="pl in paged" :key="pl.plaid" class="row">
              <div class="row-main">
                <div class="row-title">{{ pl.name }}</div>
                <div class="row-sub">
                  <span class="muted small">{{ pl.karacount ?? 0 }} songs</span>
                  <span v-if="pl.duration != null" class="dur">{{ fmtBrowseDuration(pl.duration) }}</span>
                  <span class="muted small">by {{ pl.nickname || pl.username || 'unknown' }}</span>
                  <span v-if="isSharedBy(pl)" class="tag tag-dim">shared by {{ pl.username }}</span>
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
    </details>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import PagedList from '../PagedList.vue';
import type { RemotePlaylist, PlaylistOrder } from '../../preload';

const props = defineProps<{
  collections: any[];
  username: string;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'open', id: string): void;
  (e: 'remove', id: string, name: string): void;
  (e: 'error', message: string): void;
}>();

/** `imported` + `origin === 'public'` rows from the full collections list. */
const importedCollections = computed(() =>
  props.collections.filter((c: any) => c.source === 'imported' && c.origin === 'public'),
);

// --- Browse a kara.moe user (feat 08) --------------------------------------
const browseUsername = ref('');
const browseFilter = ref('');
const browseOrder = ref<PlaylistOrder>('az');
const browseIncludeContributions = ref(true);
const browsing = ref(false);
const hasBrowsed = ref(false);
const browseResults = ref<RemotePlaylist[]>([]);
const browseError = ref('');
const importingPlaid = ref<string | null>(null);
const importError = ref<Record<string, string>>({});
async function browseUser(refresh = false): Promise<void> {
  if (!browseUsername.value || browsing.value) return;
  browsing.value = true;
  browseError.value = '';
  try {
    browseResults.value = await window.kara.collectionBrowseUser({
      username: browseUsername.value,
      filter: browseFilter.value || undefined,
      order: browseOrder.value,
      includeContributions: browseIncludeContributions.value,
      refresh,
    });
    hasBrowsed.value = true;
  } catch (e) {
    browseError.value = (e as Error).message || 'Failed to browse playlists';
  } finally {
    browsing.value = false;
  }
}
function refreshBrowse(): void {
  void browseUser(true);
}
/** Re-fetch (debounced ~300 ms) when filter/order change after a first browse. */
let browseDebounce: ReturnType<typeof setTimeout> | null = null;
watch([browseFilter, browseOrder, browseIncludeContributions], () => {
  if (!hasBrowsed.value || !browseUsername.value) return;
  if (browseDebounce) clearTimeout(browseDebounce);
  browseDebounce = setTimeout(() => {
    void browseUser();
  }, 300);
});
function isSharedBy(pl: RemotePlaylist): boolean {
  if (!pl.username || !browseUsername.value) return false;
  return pl.username.toLowerCase() !== browseUsername.value.toLowerCase();
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
      origin: 'public',
    });
    emit('refresh');
  } catch (e) {
    importError.value = { ...importError.value, [errKey]: (e as Error).message || 'Failed to import' };
  } finally {
    importingPlaid.value = null;
  }
}
function fmtBrowseDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

void props;
</script>
<style scoped>
.browse-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
}
.browse-summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  color: var(--muted);
  user-select: none;
}
.browse-summary:hover {
  color: var(--text);
}
.browse-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.browse-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.browse-state {
  margin-top: 10px;
}
.browse-error {
  color: #e07a78;
  font-size: 13px;
}
.browse-list {
  margin-top: 10px;
}
.browse-row-error {
  color: #e07a78;
  font-size: 12px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

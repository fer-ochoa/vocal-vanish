<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Collections</h1>
      <p class="muted">Your local collections of downloaded songs.</p>
    </header>
    <!-- Sync toolbar (logged in only) -->
    <div v-if="loggedIn" class="new-collection">
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
    <!-- New collection -->
    <div class="new-collection">
      <input
        v-model.trim="newName"
        class="input"
        placeholder="New collection name…"
        spellcheck="false"
        @keyup.enter="createCollection"
      />
      <button class="btn btn-primary" :disabled="!newName || busy" @click="createCollection">
        {{ busy ? '…' : 'Create' }}
      </button>
    </div>
    <!-- Browse a kara.moe user (feat 08) — public data, works logged out -->
    <details class="browse-panel">
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
      <ul v-else-if="browseResults.length" class="list browse-list">
        <li v-for="pl in browseResults" :key="pl.plaid" class="row">
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
              :disabled="isSubscribed(pl) || subscribingPlaid === pl.plaid"
              @click.stop="subscribe(pl)"
            >
              {{ subscribingPlaid === pl.plaid ? '…' : isSubscribed(pl) ? 'Subscribed' : 'Subscribe' }}
            </button>
            <span v-if="subscribeError[pl.plaid]" class="browse-row-error">{{ subscribeError[pl.plaid] }}</span>
          </div>
        </li>
      </ul>
    </details>
    <!-- Collection list -->
    <ul v-if="visibleCollections.length" class="list">
      <li
        v-for="col in visibleCollections"
        :key="col.id"
        class="row"
        @click="openDetail(col.id)"
      >
        <div class="row-main">
          <!-- Normal display -->
          <template v-if="renamingId !== col.id">
            <div class="row-title">{{ col.name }}</div>
            <div class="row-sub">
              <span class="tag" :class="sourceBadgeClass(col.source)">{{ col.source }}</span>
              <!-- remote (own/subscribed): "X of Y downloaded" + owner + synced ago -->
              <template v-if="col.source === 'remote-own' || col.source === 'remote-subscribed'">
                <span class="muted small">{{ col.songCount }} of {{ col.remoteItemCount ?? col.songCount }} downloaded</span>
                <span v-if="col.ownerUsername && col.ownerUsername !== username" class="muted small">by {{ col.ownerUsername }}</span>
                <span v-if="col.lastSyncedAt" class="muted small">{{ syncedAgo(col.lastSyncedAt) }}</span>
                <span v-if="col.remoteStale === true" class="tag tag-dim" title="This playlist is no longer public on kara.moe">no longer public</span>
              </template>
              <!-- local: bare count -->
              <span v-else class="muted small">{{ col.songCount }} song{{ col.songCount === 1 ? '' : 's' }}</span>
            </div>
          </template>
          <!-- Inline rename (local only) -->
          <template v-else>
            <input
              v-model.trim="renameValue"
              class="input input-sm"
              @keyup.enter="confirmRename(col.id)"
              @keyup.escape="cancelRename"
              ref="renameInput"
            />
          </template>
        </div>
        <div class="row-actions">
          <!-- Local rows: rename + delete -->
          <template v-if="col.source === 'local'">
            <button
              v-if="renamingId !== col.id"
              class="btn btn-ghost"
              title="Rename"
              @click.stop="startRename(col)"
            >
              Rename
            </button>
            <template v-else>
              <button class="btn btn-ghost" title="Save" @click.stop="confirmRename(col.id)">✓</button>
              <button class="btn btn-ghost" title="Cancel" @click.stop="cancelRename">✕</button>
            </template>
          </template>
          <!-- local + remote-subscribed: delete (unsubscribe for subscribed rows) -->
          <button
            v-if="col.source === 'local' || col.source === 'remote-subscribed'"
            class="btn btn-ghost"
            title="Delete"
            @click.stop="remove(col.id, col.name)"
          >
            ✕
          </button>
          <!-- remote-own: no actions (read-only mirror of kara.moe); remote-subscribed: unsubscribe only -->
        </div>
      </li>
    </ul>
    <p v-else-if="loaded" class="muted">No collections yet. Create one above.</p>
    <!-- Error toast -->
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, nextTick, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { RemotePlaylist, PlaylistOrder } from '../preload';
const router = useRouter();
const collections = ref<any[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');

// --- Account (feat 06) ----------------------------------------------------
const loggedIn = ref(false);
const username = ref('');
/** Rows actually shown: `remote-own` collections only exist for a logged-in user. */
const visibleCollections = computed(() =>
  loggedIn.value
    ? collections.value
    : collections.value.filter((c: any) => c.source !== 'remote-own'),
);

async function loadAccount(): Promise<void> {
  try {
    const status = await window.kara.accountStatus();
    loggedIn.value = status.loggedIn;
    username.value = status.username ?? '';
  } catch {
    loggedIn.value = false;
    username.value = '';
  }
}

// --- Sync toolbar (feat 06) ------------------------------------------------
const syncing = ref(false);
const order = ref<'az' | 'recent' | 'karacount' | 'duration' | 'username'>('az');
const filter = ref('');

async function syncNow(): Promise<void> {
  if (syncing.value) return;
  syncing.value = true;
  error.value = '';
  try {
    collections.value = await window.kara.collectionSyncRemoteOwn({
      filter: filter.value,
      order: order.value as any,
    });
  } catch (e) {
    error.value = (e as Error).message || 'Failed to sync playlists';
  } finally {
    syncing.value = false;
  }
}

/** "Synced 3m ago" across all remote-own rows; '' when none. */
const lastSyncedLabel = computed(() => {
  const times = collections.value
    .filter((c: any) => c.source === 'remote-own' && c.lastSyncedAt)
    .map((c: any) => new Date(c.lastSyncedAt).getTime())
    .filter((t: number) => !isNaN(t));
  if (!times.length) return '';
  const latest = Math.max(...times);
  return syncedAgo(new Date(latest).toISOString());
});

// --- Browse a kara.moe user (feat 08) --------------------------------------
const browseUsername = ref('');
const browseFilter = ref('');
const browseOrder = ref<PlaylistOrder>('az');
const browseIncludeContributions = ref(true);
const browsing = ref(false);
const hasBrowsed = ref(false);
const browseResults = ref<RemotePlaylist[]>([]);
const browseError = ref('');
const subscribingPlaid = ref<string | null>(null);
const subscribeError = ref<Record<string, string>>({});

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

function isSubscribed(pl: RemotePlaylist): boolean {
  return collections.value.some((c: any) => c.id === pl.plaid);
}

async function subscribe(pl: RemotePlaylist): Promise<void> {
  if (subscribingPlaid.value || isSubscribed(pl)) return;
  subscribingPlaid.value = pl.plaid;
  const errKey = pl.plaid;
  delete subscribeError.value[errKey];
  try {
    await window.kara.collectionSubscribe({
      plaid: pl.plaid,
      name: pl.name,
      ownerUsername: pl.username ?? null,
    });
    await load();
  } catch (e) {
    subscribeError.value = { ...subscribeError.value, [errKey]: (e as Error).message || 'Failed to subscribe' };
  } finally {
    subscribingPlaid.value = null;
  }
}

function fmtBrowseDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Open detail (feat 05) -------------------------------------------------
function openDetail(id: string): void {
  router.push({ name: 'collection-detail', params: { id } });
}

// --- Create ----------------------------------------------------------------
const newName = ref('');
async function load(): Promise<void> {
  try {
    collections.value = await window.kara.collectionsList();
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load collections';
  }
}
async function createCollection(): Promise<void> {
  if (!newName.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await window.kara.collectionCreate(newName.value);
    newName.value = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to create collection';
  } finally {
    busy.value = false;
  }
}

// --- Rename ----------------------------------------------------------------
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
function startRename(col: any): void {
  renamingId.value = col.id;
  renameValue.value = col.name;
  nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}
function cancelRename(): void {
  renamingId.value = null;
  renameValue.value = '';
}
async function confirmRename(id: string): Promise<void> {
  if (!renameValue.value) {
    cancelRename();
    return;
  }
  try {
    await window.kara.collectionRename(id, renameValue.value);
    cancelRename();
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to rename collection';
    cancelRename();
  }
}

// --- Delete ----------------------------------------------------------------
async function remove(id: string, name: string): Promise<void> {
  if (!window.confirm(`Delete collection "${name}"? Its songs will not be deleted.`)) return;
  try {
    await window.kara.collectionDelete(id);
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to delete collection';
  }
}

// --- Helpers ---------------------------------------------------------------
function sourceBadgeClass(source: string): string {
  if (source === 'local') return 'tag-accent';
  if (source === 'remote-own') return 'tag-lang';
  return 'tag-dim';
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

onMounted(() => {
  loadAccount();
  load();
});
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

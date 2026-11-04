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
              <!-- remote-own: "X of Y downloaded" + owner + synced ago -->
              <template v-if="col.source === 'remote-own'">
                <span class="muted small">{{ col.songCount }} of {{ col.remoteItemCount ?? col.songCount }} downloaded</span>
                <span v-if="col.ownerUsername && col.ownerUsername !== username" class="muted small">by {{ col.ownerUsername }}</span>
                <span v-if="col.lastSyncedAt" class="muted small">{{ syncedAgo(col.lastSyncedAt) }}</span>
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
          <template v-if="col.source !== 'remote-own'">
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
            <button class="btn btn-ghost" title="Delete" @click.stop="remove(col.id, col.name)">✕</button>
          </template>
          <!-- remote-own: no actions (read-only mirror of kara.moe) -->
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
import { onMounted, ref, nextTick, computed } from 'vue';
import { useRouter } from 'vue-router';
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

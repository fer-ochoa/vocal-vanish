<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Collections</h1>
      <p class="muted">Your local collections of downloaded songs.</p>
    </header>
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
    <ul v-if="collections.length" class="list">
      <li
        v-for="col in collections"
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
              <span class="muted small">{{ col.songCount }} song{{ col.songCount === 1 ? '' : 's' }}</span>
            </div>
          </template>
          <!-- Inline rename -->
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
import { onMounted, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
const router = useRouter();
const collections = ref<any[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
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
onMounted(load);
</script>

<template>
  <div class="local-collections-panel coll-panel">
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
            <!-- Normal display -->
            <template v-if="renamingId !== col.id">
              <div class="row-title">{{ col.name }}</div>
              <div class="row-sub">
                <span class="muted small">{{ col.songCount }} song{{ col.songCount === 1 ? '' : 's' }}</span>
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
    <p v-else-if="loaded" class="muted">No local collections yet. Create one above.</p>
  </div>
</template>
<script setup lang="ts">
import { ref, nextTick } from 'vue';
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

// --- Create ----------------------------------------------------------------
const newName = ref('');
const busy = ref(false);
async function createCollection(): Promise<void> {
  if (!newName.value || busy.value) return;
  busy.value = true;
  try {
    await window.kara.collectionCreate(newName.value);
    newName.value = '';
    emit('refresh');
  } catch (e) {
    emit('error', (e as Error).message || 'Failed to create collection');
  } finally {
    busy.value = false;
  }
}

// --- Rename ----------------------------------------------------------------
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null);
function focusRenameInput(): void {
  const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  el?.focus();
  el?.select();
}
function startRename(col: any): void {
  renamingId.value = col.id;
  renameValue.value = col.name;
  nextTick(() => {
    focusRenameInput();
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
    emit('refresh');
  } catch (e) {
    emit('error', (e as Error).message || 'Failed to rename collection');
    cancelRename();
  }
}

void props;
</script>

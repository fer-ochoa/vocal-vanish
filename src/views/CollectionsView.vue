<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Collections</h1>
      <p class="muted">{{ subtitle }}</p>
    </header>
    <nav class="coll-tabs" role="tablist" aria-label="Collection sections">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="coll-tab"
        :class="{ active: activeTab === t.id }"
        role="tab"
        :aria-selected="activeTab === t.id"
        :disabled="t.disabled"
        :title="t.hint"
        @click="selectTab(t.id)"
      >
        <span class="coll-tab-label">{{ t.label }}</span>
        <span v-if="t.count > 0" class="coll-tab-count">{{ t.count }}</span>
      </button>
    </nav>
    <LocalCollectionsPanel
      v-if="activeTab === 'local'"
      :collections="localCollections"
      :loaded="loaded"
      @refresh="load"
      @open="openDetail"
      @remove="remove"
      @error="showError"
    />
    <ImportedCollectionsPanel
      v-else-if="activeTab === 'imported'"
      :collections="importedCollections"
      :loaded="loaded"
      @refresh="load"
      @open="openDetail"
      @remove="remove"
      @error="showError"
    />
    <PublicCollectionsPanel
      v-else-if="activeTab === 'public'"
      :collections="collections"
      :username="username"
      @refresh="load"
      @open="openDetail"
      @remove="remove"
      @error="showError"
    />
    <MineCollectionsPanel
      v-else
      :collections="collections"
      :logged-in="loggedIn"
      :username="username"
      @refresh="load"
      @open="openDetail"
      @error="showError"
    />
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
    <transition name="fade">
      <div v-if="notice" class="toast toast-ok">{{ notice }}</div>
    </transition>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LocalCollectionsPanel from '../components/collections/LocalCollectionsPanel.vue';
import ImportedCollectionsPanel from '../components/collections/ImportedCollectionsPanel.vue';
import MineCollectionsPanel from '../components/collections/MineCollectionsPanel.vue';
import PublicCollectionsPanel from '../components/collections/PublicCollectionsPanel.vue';

const route = useRoute();
const router = useRouter();

const collections = ref<any[]>([]);
const loaded = ref(false);
const error = ref('');
const notice = ref('');
const loggedIn = ref(false);
const username = ref('');

async function load(): Promise<void> {
  try {
    collections.value = await window.kara.collectionsList();
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load collections';
  }
}

async function loadAccount(): Promise<void> {
  try {
    const status = await window.kara.accountStatus();
    loggedIn.value = status.loggedIn;
    username.value = status.username ?? '';
  } catch {
    loggedIn.value = false;
    username.value = '';
  }
  enforceTab();
}

function showError(message: string): void {
  error.value = message;
}

async function remove(id: string, name: string): Promise<void> {
  const col = collections.value.find((c: any) => c.id === id);
  const imported = col?.source === 'imported';
  const message = imported
    ? `Delete collection "${name}"? Songs that are not downloaded and are in no other collection will be removed from the catalog.`
    : `Delete collection "${name}"? Its songs will not be deleted.`;
  if (!window.confirm(message)) return;
  try {
    const res = await window.kara.collectionDelete(id);
    const n = res?.deletedSongs?.length ?? 0;
    if (n > 0) {
      notice.value = `Removed ${n} undownloaded song${n === 1 ? '' : 's'} from the catalog.`;
      window.setTimeout(() => { notice.value = ''; }, 4000);
    }
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to delete collection';
  }
}

function openDetail(id: string): void {
  router.push({ name: 'collection-detail', params: { id }, query: { from: activeTab.value } });
}

// --- Tab state -------------------------------------------------------------
type CollectionsTab = 'local' | 'imported' | 'public' | 'mine';
const VALID_TABS: CollectionsTab[] = ['local', 'imported', 'public', 'mine'];
const activeTab = ref<CollectionsTab>('local');

function readTabFromQuery(): CollectionsTab {
  const q = String(route.query.tab ?? '');
  return (VALID_TABS as string[]).includes(q) ? (q as CollectionsTab) : 'local';
}

function selectTab(t: CollectionsTab): void {
  if (activeTab.value === t) return;
  activeTab.value = t;
  router.replace({ name: 'collections', query: { ...route.query, tab: t } });
}

function enforceTab(): void {
  if (activeTab.value === 'mine' && !loggedIn.value) selectTab('local');
}

watch(() => route.query.tab, () => { activeTab.value = readTabFromQuery(); }, { immediate: true });
watch(loggedIn, enforceTab);

// --- Computed slices -------------------------------------------------------
const localCollections = computed(() => collections.value.filter((c: any) => c.source === 'local'));
const importedCollections = computed(() => collections.value.filter((c: any) => c.source === 'imported'));
const mineCollections = computed(() => collections.value.filter((c: any) => c.source === 'imported' && c.origin === 'own'));
const publicImportedCollections = computed(() => collections.value.filter((c: any) => c.source === 'imported' && c.origin === 'public'));

const tabs = computed(() => [
  { id: 'local' as CollectionsTab, label: 'Local', count: localCollections.value.length, disabled: false, hint: 'Collections stored on this machine' },
  { id: 'imported' as CollectionsTab, label: 'Imported', count: importedCollections.value.length, disabled: false, hint: 'Local copies of kara.moe playlists you imported' },
  { id: 'public' as CollectionsTab, label: 'Public', count: publicImportedCollections.value.length, disabled: false, hint: 'Browse public kara.moe playlists and what you imported' },
  { id: 'mine' as CollectionsTab, label: 'Mine', count: mineCollections.value.length, disabled: !loggedIn.value, hint: loggedIn.value ? 'Your own kara.moe playlists' : 'Log in on the Config screen to see your kara.moe playlists' },
]);

const subtitle = computed(() =>
  activeTab.value === 'local'
    ? 'Collections of downloaded songs stored on this machine.'
    : activeTab.value === 'imported'
      ? 'Local copies of kara.moe playlists you imported.'
      : activeTab.value === 'public'
        ? 'Public kara.moe playlists you can browse and import.'
        : 'Your own kara.moe playlists, mirrored from kara.moe.',
);

onMounted(() => {
  loadAccount();
  load();
});
</script>

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
      :collections="mineCollections"
      :logged-in="loggedIn"
      :username="username"
      @refresh="load"
      @open="openDetail"
      @error="showError"
    />
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LocalCollectionsPanel from '../components/collections/LocalCollectionsPanel.vue';
import MineCollectionsPanel from '../components/collections/MineCollectionsPanel.vue';
import PublicCollectionsPanel from '../components/collections/PublicCollectionsPanel.vue';

const route = useRoute();
const router = useRouter();

const collections = ref<any[]>([]);
const loaded = ref(false);
const error = ref('');
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
  if (!window.confirm(`Delete collection "${name}"? Its songs will not be deleted.`)) return;
  try {
    await window.kara.collectionDelete(id);
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to delete collection';
  }
}

function openDetail(id: string): void {
  router.push({ name: 'collection-detail', params: { id }, query: { from: activeTab.value } });
}

// --- Tab state -------------------------------------------------------------
type CollectionsTab = 'local' | 'public' | 'mine';
const VALID_TABS: CollectionsTab[] = ['local', 'public', 'mine'];
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
const mineCollections = computed(() => loggedIn.value ? collections.value.filter((c: any) => c.source === 'remote-own') : []);
const subscribedCollections = computed(() => collections.value.filter((c: any) => c.source === 'remote-subscribed'));

const tabs = computed(() => [
  { id: 'local' as CollectionsTab, label: 'Local', count: localCollections.value.length, disabled: false, hint: 'Collections stored on this machine' },
  { id: 'public' as CollectionsTab, label: 'Public', count: subscribedCollections.value.length, disabled: false, hint: 'Browse public kara.moe playlists and what you subscribed to' },
  { id: 'mine' as CollectionsTab, label: 'Mine', count: mineCollections.value.length, disabled: !loggedIn.value, hint: loggedIn.value ? 'Your own kara.moe playlists' : 'Log in on the Config screen to see your kara.moe playlists' },
]);

const subtitle = computed(() =>
  activeTab.value === 'local'
    ? 'Collections of downloaded songs stored on this machine.'
    : activeTab.value === 'public'
      ? 'Public kara.moe playlists you can browse and subscribe to.'
      : 'Your own kara.moe playlists, mirrored from kara.moe.',
);

onMounted(() => {
  loadAccount();
  load();
});
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Catalog</h1>
      <p class="muted">Every song in your library — downloaded or not.</p>
    </header>

    <div class="searchbar">
      <input v-model.trim="filter" class="input" placeholder="Filter by title, series or singer…" spellcheck="false" />
      <span class="muted small">{{ shown.length }} song{{ shown.length === 1 ? '' : 's' }}</span>
    </div>

    <PagedList
      v-if="shown.length"
      :items="shown"
      :sizes="PAGE_SIZES"
      :reset-key="filter"
      class="list-section--grow"
      v-slot="{ paged }"
    >
      <ul class="list">
        <li v-for="entry in paged" :key="entry.kid" class="row">
          <div class="row-main">
            <div class="row-title">{{ entry.title }}</div>
            <div class="row-sub">
              <span v-if="entry.series" class="tag">{{ entry.series }}</span>
              <span v-if="entry.singer" class="tag tag-dim">{{ entry.singer }}</span>
              <span v-for="lang in entry.langs || []" :key="lang" class="tag tag-lang" title="Song language">{{ lang }}</span>
              <span v-if="entry.offVocal" class="tag tag-offvocal" title="This version is already instrumental">Off Vocal</span>
              <span v-if="entry.duration" class="dur">{{ fmtDuration(entry.duration) }}</span>
              <span v-if="entry.lyriclessFile" class="tag tag-accent">Lyricless</span>
              <span v-if="!entry.downloaded" class="tag tag-dim">Not Downloaded</span>
            </div>
          </div>
          <div class="row-actions">
            <button
              v-if="entry.downloaded"
              class="btn"
              :class="playButtonClass(entry)"
              :title="playButtonTitle(entry)"
              @click="play(entry.kid)"
            >
              Play
            </button>
            <button
              v-if="entry.downloaded && canGenerateLyricless(entry)"
              class="btn"
              :disabled="processing !== null"
              title="Generate lyricless version"
              @click="startLyricless(entry)"
            >
              Lyricless
            </button>
            <button
              v-if="!entry.downloaded"
              class="btn btn-primary"
              :disabled="downloadingKid !== null"
              @click="downloadOne(entry.kid)"
            >
              {{ downloadingKid === entry.kid ? '…' : 'Download' }}
            </button>
            <!-- Add to collection (feat 04) -->
            <div class="collection-menu" v-if="collections.length">
              <button class="btn btn-ghost" title="Add to collection" @click="toggleCollectionMenu(entry.kid)">
                📁
              </button>
              <div v-if="openCollectionMenu === entry.kid" class="collection-dropdown">
                <div class="collection-dropdown-title">Collections</div>
                <label
                  v-for="col in collections"
                  :key="col.id"
                  class="collection-dropdown-item"
                >
                  <input
                    type="checkbox"
                    :checked="isInCollection(entry.kid, col.id)"
                    @change="toggleCollectionMembership(entry.kid, col.id)"
                  />
                  <span>{{ col.name }}</span>
                </label>
              </div>
            </div>
            <button class="btn btn-ghost" title="Delete" @click="remove(entry.kid)">✕</button>
          </div>
        </li>
      </ul>
    </PagedList>
    <p v-else-if="loaded" class="muted">Nothing here yet. Download some songs from the Search screen.</p>



    <!-- Lyricless progress overlay -->
    <transition name="fade">
      <div v-if="processing !== null" class="overlay">
        <div class="dialog">
          <h2>Generating lyricless…</h2>
          <p class="muted">{{ processTitle }}</p>
          <div class="bar"><div class="bar-fill" :style="{ width: processPct + '%' }" /></div>
          <p class="small muted">{{ processLabel }}</p>
        </div>
      </div>
    </transition>

    <!-- Error toast -->
    <transition name="fade">
      <div v-if="error" class="toast">{{ error }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PagedList from '../components/PagedList.vue';
import { processSongLyricless, pipelineOverallPct } from '../lyricless/processSong';

const router = useRouter();
const entries = ref<any[]>([]);
const filter = ref('');
const loaded = ref(false);
const error = ref('');
// --- Collections (feat 04) ------------------------------------------------
const collections = ref<any[]>([]);
const openCollectionMenu = ref<string | null>(null);
// kid -> Set<collectionId> for quick membership lookup
const membershipMap = ref<Map<string, Set<string>>>(new Map());

async function loadCollections(): Promise<void> {
  try {
    collections.value = (await window.kara.collectionsList()).filter(
      (c) => c.source === 'local',
    );
  } catch {
    collections.value = [];
  }
}

async function loadMembership(kid: string): Promise<void> {
  try {
    const cols = await window.kara.collectionsForSong(kid);
    const set = new Set(cols.map((c: any) => c.id));
    membershipMap.value.set(kid, set);
  } catch {
    membershipMap.value.set(kid, new Set());
  }
}

function isInCollection(kid: string, collectionId: string): boolean {
  return membershipMap.value.get(kid)?.has(collectionId) ?? false;
}

function toggleCollectionMenu(kid: string): void {
  if (openCollectionMenu.value === kid) {
    openCollectionMenu.value = null;
    return;
  }
  openCollectionMenu.value = kid;
  // Lazy-load membership for this song if not already cached
  if (!membershipMap.value.has(kid)) {
    loadMembership(kid);
  }
}

async function toggleCollectionMembership(kid: string, collectionId: string): Promise<void> {
  const currentlyIn = isInCollection(kid, collectionId);
  try {
    if (currentlyIn) {
      await window.kara.collectionRemoveSong(collectionId, kid);
    } else {
      await window.kara.collectionAddSong(collectionId, kid);
    }
    // Update local membership cache
    const set = membershipMap.value.get(kid) ?? new Set<string>();
    if (currentlyIn) {
      set.delete(collectionId);
    } else {
      set.add(collectionId);
    }
    membershipMap.value.set(kid, set);
  } catch (e) {
    error.value = (e as Error).message || 'Failed to update collection';
  }
}

// --- Single-song download --------------------------------------------------
const downloadingKid = ref<string | null>(null);
async function downloadOne(kid: string): Promise<void> {
  if (downloadingKid.value !== null) return;
  downloadingKid.value = kid;
  try {
    const updated = await window.kara.download(kid);
    const idx = entries.value.findIndex((e) => e.kid === kid);
    if (idx !== -1) {
      entries.value[idx] = updated;
    }
  } catch (e) {
    error.value = (e as Error).message || 'Download failed';
  } finally {
    downloadingKid.value = null;
  }
}
// --- Pagination ------------------------------------------------------------
const PAGE_SIZES = [10, 25, 50, 100, 250];

// --- Lyricless generation state -------------------------------------------
const processing = ref<string | null>(null); // kid being processed, or null
const processTitle = ref('');
const processLabel = ref('');
const processPct = ref(0);

async function load(): Promise<void> {
  try {
    entries.value = await window.kara.catalog();
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Failed to load catalog';
    return;
  }
  // Entries downloaded before the langs/offVocal fields existed are filled in
  // in the background; the list re-renders when they arrive.
  try {
    const updated = await window.kara.backfillCatalogMetadata();
    mergeEntries(updated);
  } catch {
    /* offline or API gone — rows just render without the extra chips */
  }
}

/** Replace stale rows with freshly resolved copies, keeping the list order. */
function mergeEntries(updated: any[]): void {
  if (!updated?.length) return;
  const byKid = new Map(updated.map((e) => [e.kid, e]));
  entries.value = entries.value.map((e) => byKid.get(e.kid) || e);
}

// --- Row state helpers ----------------------------------------------------
// An off-vocal song is already instrumental, and a song that already has a
// lyricless file needs no second pass: in both cases the Lyricless action is
// hidden.
function canGenerateLyricless(entry: any): boolean {
  return !entry.lyriclessFile && !entry.offVocal;
}

function playButtonClass(entry: any): string {
  if (entry.offVocal) return 'btn-offvocal';
  // Already processed -> accent blue, matching the Lyricless chip on the row.
  if (entry.lyriclessFile) return 'btn-primary';
  // Plain song -> default neutral button, like the Lyricless one next to it.
  return '';
}

function playButtonTitle(entry: any): string {
  if (entry.offVocal) return 'Play (off vocal version)';
  if (entry.lyriclessFile) return 'Play (lyricless version available)';
  return 'Play';
}

const shown = computed(() => {
  const f = filter.value.toLowerCase();
  if (!f) return entries.value;
  return entries.value.filter(
    (e) =>
      e.title.toLowerCase().includes(f) ||
      e.series.toLowerCase().includes(f) ||
      e.singer.toLowerCase().includes(f),
  );
});


function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}

async function remove(kid: string): Promise<void> {
  if (!window.confirm('Remove this song from your library?')) return;
  try {
    await window.kara.delete(kid);
    // Soft delete keeps the row when the song belongs to a collection, so
    // reload from the catalog instead of filtering locally.
    await load();
  } catch (e) {
    error.value = (e as Error).message || 'Delete failed';
  }
}

async function startLyricless(entry: any): Promise<void> {
  if (processing.value !== null) return; // already processing
  processing.value = entry.kid;
  processTitle.value = entry.title;
  processLabel.value = 'Starting…';
  processPct.value = 0;
  error.value = '';

  try {
    const result = await processSongLyricless(entry.kid, (p) => {
      processLabel.value = p.label;
      processPct.value = pipelineOverallPct(p);
    });
    const idx = entries.value.findIndex((e) => e.kid === entry.kid);
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], lyriclessFile: result.lyriclessFile };
    }
  } catch (e) {
    error.value = (e as Error).message || 'Lyricless generation failed';
  } finally {
    processing.value = null;
  }
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

onMounted(() => {
  load();
  loadCollections();
});
</script>

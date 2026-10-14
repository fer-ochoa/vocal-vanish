<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Catalog</h1>
      <p class="muted">Your locally downloaded hardsubbed songs.</p>
    </header>

    <div class="searchbar">
      <input v-model.trim="filter" class="input" placeholder="Filter by title, series or singer…" spellcheck="false" />
      <span class="muted small">{{ shown.length }} song{{ shown.length === 1 ? '' : 's' }}</span>
    </div>

    <ul v-if="shown.length" class="list">
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
          </div>
        </div>
        <div class="row-actions">
          <button
            class="btn"
            :class="playButtonClass(entry)"
            :title="playButtonTitle(entry)"
            @click="play(entry.kid)"
          >
            Play
          </button>
          <button
            v-if="canGenerateLyricless(entry)"
            class="btn"
            :disabled="processing !== null"
            title="Generate lyricless version"
            @click="startLyricless(entry)"
          >
            Lyricless
          </button>
          <button class="btn btn-ghost" title="Delete" @click="remove(entry.kid)">✕</button>
        </div>
      </li>
    </ul>
    <p v-else-if="loaded" class="muted">Nothing here yet. Download some songs from the Search screen.</p>

    <!-- Footer: page size + page navigation -->
    <ListFooter
      v-if="shown.length"
      :sizes="PAGE_SIZES"
      :size="size"
      :total="shown.length"
      :page="page"
      @update:size="changeSize"
      @update:page="goPage"
    />

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
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ListFooter from '../components/ListFooter.vue';
import { generateLyricless } from '../lyricless/pipeline';

const router = useRouter();
const entries = ref<any[]>([]);
const filter = ref('');
const loaded = ref(false);
const error = ref('');

// --- Pagination ------------------------------------------------------------
const PAGE_SIZES = [10, 25, 50, 100, 250];
const size = ref(25);
const page = ref(1); // 1-based

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

const totalPages = computed(() => Math.max(1, Math.ceil(shown.value.length / size.value)));

// The slice of the filtered list rendered on the current page.
const paged = computed(() => {
  const start = (page.value - 1) * size.value;
  return shown.value.slice(start, start + size.value);
});

function goPage(target: number): void {
  page.value = Math.min(Math.max(1, target), totalPages.value);
}

// Changing the page size keeps the first row you were looking at, snapped to
// the new page grid and clamped to the last page.
function changeSize(next: number): void {
  const firstVisible = (page.value - 1) * size.value;
  size.value = next;
  page.value = Math.min(Math.floor(firstVisible / next) + 1, totalPages.value);
}

// A new filter starts from the first page; deleting rows (or shrinking the
// page size) can leave the current page past the end, so pull it back.
watch(filter, () => {
  page.value = 1;
});
watch([() => shown.value.length, size], () => {
  if (page.value > totalPages.value) page.value = totalPages.value;
});

function play(kid: string): void {
  router.push({ name: 'player', params: { kid } });
}

async function remove(kid: string): Promise<void> {
  if (!window.confirm('Delete this song from your catalog?')) return;
  try {
    await window.kara.delete(kid);
    entries.value = entries.value.filter((e) => e.kid !== kid);
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
    // Stream the original video bytes from the main process.
    const buf = await window.kara.openMediaStream(entry.kid);

    // Run the full pipeline: decode → separate → re-mux.
    const lyriclessBytes = await generateLyricless(buf, (p) => {
      processLabel.value = p.label;
      // Map stage fractions to an overall 0-100% range.
      const stageWeight = p.stage === 'decode' ? 0.1 : p.stage === 'separate' ? 0.7 : 0.2;
      const stageStart = p.stage === 'decode' ? 0 : p.stage === 'separate' ? 10 : 80;
      processPct.value = Math.round(stageStart + p.fraction * stageWeight * 100);
    });

    // Write the result to disk via IPC.
    await window.kara.writeLyricless(entry.kid, lyriclessBytes);

    // Update the local entry.
    const idx = entries.value.findIndex((e) => e.kid === entry.kid);
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], lyriclessFile: `${entry.kid}.lyricless.mp4` };
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

onMounted(load);
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1>Search</h1>
      <p class="muted">Find karaoke songs on kara.moe and download the hardsubbed video.</p>
    </header>

    <form class="searchbar" @submit.prevent="runSearch(0)">
      <select v-model="criterion" class="criterion" title="Search criteria">
        <option value="text">Title / Series / Singer</option>
        <option value="year">Year</option>
        <option value="kid">Song ID (KID)</option>
      </select>
      <input
        v-model.trim="query"
        class="input"
        :placeholder="placeholder"
        spellcheck="false"
        @keyup.enter="runSearch(0)"
      />
      <button type="submit" class="btn btn-primary" :disabled="loading">Search</button>
    </form>

    <!-- Results -->
    <div v-if="searched" class="results">
      <p class="muted small">{{ count }} result{{ count === 1 ? '' : 's' }}</p>

      <ul v-if="rows.length" class="list">
        <li v-for="row in rows" :key="row.kid" class="row">
          <div class="row-main">
            <div class="row-title">{{ row.title }}</div>
            <div class="row-sub">
              <span v-if="row.series" class="tag">{{ row.series }}</span>
              <span v-if="row.singer" class="tag tag-dim">{{ row.singer }}</span>
              <span v-for="lang in row.langs || []" :key="lang" class="tag tag-lang" title="Song language">{{ lang }}</span>
              <span v-if="row.offVocal" class="tag tag-offvocal" title="This version is already instrumental">Off Vocal</span>
              <span v-if="row.duration" class="dur">{{ fmtDuration(row.duration) }}</span>
            </div>
          </div>
          <button
            class="btn"
            :class="row.downloaded ? 'btn-downloaded' : 'btn-primary'"
            :disabled="row.downloaded"
            :title="row.downloaded ? 'Already in your catalog' : 'Download this song'"
            @click="startDownload(row.kid)"
          >
            {{ row.downloaded ? 'Downloaded' : 'Download' }}
          </button>
        </li>
      </ul>
      <p v-else class="muted">No songs found.</p>

      <!-- Footer: page size + page navigation -->
      <ListFooter
        v-if="rows.length"
        :sizes="PAGE_SIZES"
        :size="size"
        :total="count"
        :page="page"
        :disabled="loading"
        @update:size="changeSize"
        @update:page="goPage"
      />
    </div>

    <!-- Download progress overlay -->
    <transition name="fade">
      <div v-if="downloading" class="overlay">
        <div class="dialog">
          <h2>Downloading…</h2>
          <p class="muted">{{ downloadTitle }}</p>
          <div class="bar"><div class="bar-fill" :style="{ width: pct + '%' }" /></div>
          <p class="small muted">{{ fmtBytes(downloaded.received) }}{{ downloaded.total ? ' / ' + fmtBytes(downloaded.total) : '' }} · {{ pct }}%</p>
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
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import ListFooter from '../components/ListFooter.vue';

// Page sizes offered in the footer dropdown. The kara.moe search endpoint
// happily serves large pages, so the list can be browsed a chunk at a time.
const PAGE_SIZES = [10, 25, 50, 100, 250];

const query = ref('');
const criterion = ref<'text' | 'year' | 'kid'>('text');
const rows = ref<any[]>([]);
const count = ref(0);
const from = ref(0);
const size = ref(25);
const searched = ref(false);
const loading = ref(false);
const error = ref('');

// 1-based page derived from the API offset.
const page = computed(() => Math.floor(from.value / size.value) + 1);

const placeholder = computed(() => {
  if (criterion.value === 'year') return 'e.g. 2019';
  if (criterion.value === 'kid') return 'KID uuid';
  return 'Search title, series or singer…';
});

// Build the API query for the chosen criterion.
function buildQuery(): string {
  const q = query.value;
  if (!q) return '';
  if (criterion.value === 'year') return `y:${q}`;
  if (criterion.value === 'kid') return `k:${q}`;
  return q; // plain text -> "filter"
}

async function runSearch(startFrom: number): Promise<void> {
  loading.value = true;
  error.value = '';
  const q = buildQuery();
  try {
    const res = await window.kara.search({ query: q, from: startFrom, size: size.value, mode: criterion.value });
    rows.value = res.rows;
    count.value = res.count;
    from.value = startFrom;
    searched.value = true;
  } catch (e) {
    error.value = (e as Error).message || 'Search failed';
  } finally {
    loading.value = false;
  }
}

function goPage(target: number): void {
  if (loading.value) return;
  const start = (target - 1) * size.value;
  if (start === from.value) return;
  void runSearch(start);
}

// Changing the page size keeps the first row you were looking at: the current
// offset is snapped to the new page grid and clamped to the last page.
function changeSize(next: number): void {
  if (next === size.value) return;
  size.value = next;
  const lastPageStart = Math.max(0, (Math.ceil(count.value / next) - 1) * next);
  const start = Math.min(Math.floor(from.value / next) * next, lastPageStart);
  void runSearch(start);
}

// --- Download flow -------------------------------------------------------
const downloading = ref(false);
const downloadTitle = ref('');
const downloaded = reactive({ received: 0, total: null as number | null });
let offProgress: (() => void) | null = null;

async function startDownload(kid: string): Promise<void> {
  const row = rows.value.find((r) => r.kid === kid);
  if (!row || row.downloaded) return; // already in the catalog
  downloadTitle.value = row.title || kid;
  downloaded.received = 0;
  downloaded.total = row?.size ?? null;
  downloading.value = true;
  error.value = '';

  offProgress = window.kara.onDownloadProgress((p) => {
    if (p.kid === kid) {
      downloaded.received = p.received;
      if (p.total) downloaded.total = p.total;
    }
  });

  try {
    await window.kara.download(kid);
    // Reflect ownership immediately so the button greys out without re-searching.
    row.downloaded = true;
  } catch (e) {
    error.value = (e as Error).message || 'Download failed';
  } finally {
    downloading.value = false;
    offProgress?.();
    offProgress = null;
  }
}

const pct = computed(() =>
  downloaded.total ? Math.min(100, Math.round((downloaded.received / downloaded.total) * 100)) : 0,
);

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtBytes(n: number | null): string {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

onBeforeUnmount(() => offProgress?.());
</script>

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
              <span v-if="row.duration" class="dur">{{ fmtDuration(row.duration) }}</span>
            </div>
          </div>
          <button class="btn btn-primary" @click="startDownload(row.kid)">Download</button>
        </li>
      </ul>
      <p v-else class="muted">No songs found.</p>

      <!-- Pagination -->
      <div class="pager">
        <button class="btn" :disabled="from === 0 || loading" @click="runSearch(from - SIZE)">‹ Prev</button>
        <span class="muted small">{{ from + 1 }}–{{ Math.min(from + rows.length, count) }} of {{ count }}</span>
        <button class="btn" :disabled="from + rows.length >= count || loading" @click="runSearch(from + SIZE)">Next ›</button>
      </div>
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

const SIZE = 25;

const query = ref('');
const criterion = ref<'text' | 'year' | 'kid'>('text');
const rows = ref<any[]>([]);
const count = ref(0);
const from = ref(0);
const searched = ref(false);
const loading = ref(false);
const error = ref('');

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
    const res = await window.kara.search({ query: q, from: startFrom, size: SIZE, mode: criterion.value });
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

// --- Download flow -------------------------------------------------------
const downloading = ref(false);
const downloadTitle = ref('');
const downloaded = reactive({ received: 0, total: null as number | null });
let offProgress: (() => void) | null = null;

async function startDownload(kid: string): Promise<void> {
  const row = rows.value.find((r) => r.kid === kid);
  downloadTitle.value = row?.title || kid;
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

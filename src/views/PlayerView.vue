<template>
  <div class="player-screen">
    <header class="screen-head">
      <button class="btn btn-ghost" @click="back">‹ Back to catalog</button>
      <h1>{{ title }}</h1>
    </header>

    <!-- Tab bar: Original / Lyricless -->
    <div v-if="title" class="tabs">
      <button
        class="tab"
        :class="{ active: tab === 'original' }"
        @click="switchTab('original')"
      >Original</button>
      <button
        class="tab"
        :class="{ active: tab === 'lyricless' }"
        @click="switchTab('lyricless')"
      >Lyricless</button>
    </div>

    <div v-if="error" class="muted">{{ error }}</div>
    <div v-else class="video-wrap">
      <!-- video.js mounts here; the element id is fixed per player instance. -->
      <video ref="videoEl" class="video-js vjs-default-skin" controls preload="auto"></video>
    </div>

    <!-- Lyricless not-yet-generated placeholder -->
    <div v-if="tab === 'lyricless' && !lyriclessExists && !error" class="lyricless-placeholder">
      <p class="muted">Lyricless version not generated yet.</p>
      <button class="btn btn-primary" @click="goGenerate">Generate Lyricless</button>
    </div>

    <!-- Loading indicator for lyricless tab -->
    <transition name="fade">
      <div v-if="loadingLyricless" class="overlay">
        <div class="dialog">
          <h2>Loading…</h2>
          <p class="muted">Fetching lyricless video</p>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

const props = defineProps<{ kid: string }>();
const router = useRouter();

const videoEl = ref<HTMLElement | null>(null);
const title = ref('');
const error = ref('');
const tab = ref<'original' | 'lyricless'>('original');
const lyriclessExists = ref(false);
const loadingLyricless = ref(false);

let player: ReturnType<typeof videojs> | null = null;
let originalUrl: string | null = null;
let lyriclessUrl: string | null = null;

onMounted(async () => {
  try {
    const entries = await window.kara.catalog();
    const entry = entries.find((e) => e.kid === props.kid);
    if (!entry) throw new Error('Song not found in catalog.');
    title.value = entry.title;

    // Check if a lyricless variant exists.
    const status = await window.kara.lyriclessStatus(props.kid);
    lyriclessExists.value = status.exists;

    // Load the original video (always available).
    await loadOriginal();
  } catch (e) {
    error.value = (e as Error).message || 'Could not load video.';
  }
});

async function loadOriginal(): Promise<void> {
  const buf = await window.kara.openMediaStream(props.kid);
  originalUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
  createPlayer(originalUrl);
}

function createPlayer(src: string): void {
  if (player) {
    player.src({ src, type: 'video/mp4' });
    return;
  }
  player = videojs(videoEl.value as Element, {
    controls: true,
    autoplay: false,
    fluid: true,
    responsive: true,
    sources: [{ src, type: 'video/mp4' }],
  });
}

async function switchTab(newTab: 'original' | 'lyricless'): Promise<void> {
  if (newTab === tab.value) return;
  tab.value = newTab;
  error.value = '';

  if (newTab === 'original') {
    if (originalUrl) createPlayer(originalUrl);
    return;
  }

  // Lyricless tab.
  if (!lyriclessExists.value) return; // placeholder is shown

  if (lyriclessUrl) {
    createPlayer(lyriclessUrl);
    return;
  }

  // Lazy-load the lyricless video on first switch.
  loadingLyricless.value = true;
  try {
    const status = await window.kara.lyriclessStatus(props.kid);
    if (!status.exists) {
      lyriclessExists.value = false;
      return;
    }
    // Stream the lyricless file (the main process reads entry.lyriclessFile
    // when variant === 'lyricless').
    const buf = await window.kara.openMediaStream(props.kid, 'lyricless');
    lyriclessUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
    createPlayer(lyriclessUrl);
  } catch (e) {
    error.value = (e as Error).message || 'Could not load lyricless video.';
  } finally {
    loadingLyricless.value = false;
  }
}

function goGenerate(): void {
  router.push({ name: 'catalog' });
}

function back(): void {
  router.push({ name: 'catalog' });
}

onBeforeUnmount(() => {
  if (player) {
    player.dispose();
    player = null;
  }
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (lyriclessUrl) URL.revokeObjectURL(lyriclessUrl);
});
</script>

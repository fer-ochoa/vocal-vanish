<template>
  <div class="player-screen">
    <header class="screen-head">
      <button class="btn btn-ghost" @click="back">‹ Back to catalog</button>
      <h1>{{ title }}</h1>
    </header>

    <div v-if="error" class="muted">{{ error }}</div>
    <div v-else class="video-wrap">
      <!-- video.js mounts here; the element id is fixed per player instance. -->
      <video ref="videoEl" class="video-js vjs-default-skin" controls preload="auto"></video>
    </div>
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
let player: ReturnType<typeof videojs> | null = null;
let blobUrl: string | null = null;

onMounted(async () => {
  try {
    const entries = await window.kara.catalog();
    const entry = entries.find((e) => e.kid === props.kid);
    if (!entry) throw new Error('Song not found in catalog.');
    title.value = entry.title;

    // Stream the video bytes from the main process and wrap them in a Blob.
    // A blob: URL is allowed by Electron's default CSP (unlike file:// or a
    // custom protocol), so this plays in both dev and production. The hardsubbed
    // video already has the subtitles burned in, so no separate track is needed.
    const buf = await window.kara.openMediaStream(props.kid);
    blobUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));

    player = videojs(videoEl.value as Element, {
      controls: true,
      autoplay: false,
      fluid: true,
      responsive: true,
      sources: [{ src: blobUrl, type: 'video/mp4' }],
    });
  } catch (e) {
    error.value = (e as Error).message || 'Could not load video.';
  }
});

function back(): void {
  router.push({ name: 'catalog' });
}

onBeforeUnmount(() => {
  if (player) {
    player.dispose();
    player = null;
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
});
</script>

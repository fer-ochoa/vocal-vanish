<template>
  <footer class="list-footer">
    <!-- Left: page size picker + how many pages of that size are still ahead -->
    <div class="footer-side">
      <label class="footer-size">
        <span class="footer-label">Per page</span>
        <select class="page-size" :value="size" :disabled="disabled" @change="onSizeChange">
          <option v-for="option in sizes" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <span class="footer-note muted small">{{ morePagesText }}</span>
    </div>

    <!-- Right: page number with first / previous / next / last navigation -->
    <div class="footer-side">
      <button
        class="btn btn-page"
        title="First page"
        :disabled="disabled || page <= 1"
        @click="goPage(1)"
      >
        «
      </button>
      <button
        class="btn btn-page"
        title="Previous page"
        :disabled="disabled || page <= 1"
        @click="goPage(page - 1)"
      >
        ‹
      </button>
      <span class="page-indicator">
        Page <strong>{{ page }}</strong> of {{ totalPages }}
      </span>
      <button
        class="btn btn-page"
        title="Next page"
        :disabled="disabled || page >= totalPages"
        @click="goPage(page + 1)"
      >
        ›
      </button>
      <button
        class="btn btn-page"
        title="Last page"
        :disabled="disabled || page >= totalPages"
        @click="goPage(totalPages)"
      >
        »
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Page-size options offered in the dropdown. */
    sizes?: number[];
    /** Current page size. */
    size: number;
    /** Total number of items across all pages. */
    total: number;
    /** 1-based current page. */
    page: number;
    /** Grey out every control (e.g. while a page is loading). */
    disabled?: boolean;
  }>(),
  {
    sizes: () => [10, 25, 50, 100, 250],
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:size', size: number): void;
  (e: 'update:page', page: number): void;
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));

const pagesAhead = computed(() => Math.max(0, totalPages.value - props.page));

const morePagesText = computed(() => {
  if (props.total === 0) return 'No items';
  if (pagesAhead.value === 0) return 'No more pages';
  return `${pagesAhead.value} more page${pagesAhead.value === 1 ? '' : 's'} of ${props.size}`;
});

function goPage(target: number): void {
  const clamped = Math.min(Math.max(1, target), totalPages.value);
  if (clamped === props.page || props.disabled) return;
  emit('update:page', clamped);
}

function onSizeChange(event: Event): void {
  const next = Number((event.target as HTMLSelectElement).value);
  if (!Number.isNaN(next) && next !== props.size) emit('update:size', next);
}
</script>

<template>
  <div class="list-section">
    <slot :paged="paged" :total="total" :page="page" :size="size" :total-pages="totalPages" />
    <ListFooter
      v-if="total > 0"
      :sizes="sizes"
      :size="size"
      :total="total"
      :page="page"
      :disabled="disabled"
      @update:size="changeSize"
      @update:page="goPage"
    />
  </div>
</template>

<script setup lang="ts">
import { toRef, watch } from 'vue';
import ListFooter from './ListFooter.vue';
import { DEFAULT_PAGE_SIZES, usePagination } from '../composables/usePagination';

const props = withDefaults(
  defineProps<{
    /** The full (already filtered) list to page through. */
    items: any[];
    /** Page-size options offered in the footer dropdown. */
    sizes?: number[];
    /** Page size used before the user picks another one. */
    initialSize?: number;
    /** Grey out every footer control (e.g. while a page is loading). */
    disabled?: boolean;
    /**
     * When this value changes the list jumps back to page 1. Pass a primitive
     * (a string), never a freshly-built array, or the watch fires on every
     * parent re-render.
     */
    resetKey?: string | number | boolean | null;
  }>(),
  {
    sizes: () => DEFAULT_PAGE_SIZES,
    initialSize: 25,
    disabled: false,
    resetKey: null,
  },
);

const { sizes, size, page, total, totalPages, paged, goPage, changeSize, reset } = usePagination(
  toRef(props, 'items'),
  { sizes: props.sizes, initialSize: props.initialSize },
);

watch(
  () => props.resetKey,
  () => reset(),
);
</script>

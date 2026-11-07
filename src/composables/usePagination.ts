import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** Page sizes offered by the shared list footer. */
export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100, 250];

export interface PaginationOptions {
  /** Page-size options offered in the footer dropdown. */
  sizes?: number[];
  /** Page size used before the user picks another one. */
  initialSize?: number;
}

/**
 * Shared list pagination: page size, current page and the visible slice.
 *
 * Used by the catalog and by every collection tab so they all page the same
 * way and can render the same <ListFooter>.
 */
export function usePagination<T>(items: Ref<T[]>, options: PaginationOptions = {}) {
  const sizes = options.sizes ?? DEFAULT_PAGE_SIZES;
  const size = ref(options.initialSize ?? 25);
  const page = ref(1); // 1-based

  const total = computed(() => items.value.length);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)));

  // The slice of the list rendered on the current page.
  const paged = computed(() => {
    const start = (page.value - 1) * size.value;
    return items.value.slice(start, start + size.value);
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

  function reset(): void {
    page.value = 1;
  }

  // Deleting rows (or shrinking the page size) can leave the current page past
  // the end, so pull it back.
  watch([total, size], () => {
    if (page.value > totalPages.value) page.value = totalPages.value;
  });

  return { sizes, size, page, total, totalPages, paged, goPage, changeSize, reset };
}

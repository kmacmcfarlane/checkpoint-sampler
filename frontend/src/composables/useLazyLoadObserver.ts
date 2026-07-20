import { ref, watch, nextTick, onBeforeUnmount, type Ref } from 'vue'

export interface UseLazyLoadObserverOptions {
  /** Whether the host container is visible. The observer only runs while true. */
  active: Ref<boolean>
  /** Whether more pages exist to load. */
  hasMore: () => boolean
  /** Whether a load is already in flight. */
  isLoading: () => boolean
  /** Called when the sentinel comes within the prefetch margin. */
  onLoadMore: () => void
  /**
   * Distance ahead of the sentinel at which to trigger, in px.
   * Defaults to 600px so loading happens before the user reaches the bottom.
   */
  rootMargin?: string
}

export interface UseLazyLoadObserver {
  /** Bind to the scrolling element; used as the observer root. */
  scrollContainer: Ref<HTMLElement | null>
  /** Bind to a zero-height element at the end of the list. */
  loadMoreSentinel: Ref<HTMLElement | null>
}

/**
 * Prefetch-ahead lazy loading via IntersectionObserver (S-170).
 *
 * An observer watches a sentinel element at the bottom of a list. A large
 * rootMargin means the sentinel "intersects" well before it is actually
 * scrolled into view, so onLoadMore fires ahead of the scroll position and the
 * next page is fetched invisibly (no manual "load more" button). The observer's
 * root is the host's own scroll container so it works inside a modal's internal
 * scroll region.
 *
 * Extracted from JobProgressPanel.vue (R-021), preserving:
 *
 *  - The observer is (re)connected on the nextTick after `active` becomes true,
 *    because the sentinel and container refs do not exist until the container
 *    has rendered.
 *  - Any previous observer is disconnected before a new one is created, so
 *    reopening never leaks a second observer onto a stale DOM node.
 *  - Environments without IntersectionObserver (jsdom in unit tests) are a
 *    silent no-op rather than a crash.
 *  - The load-more guard is re-evaluated at callback time via function props, so
 *    a burst of intersection events cannot enqueue duplicate loads.
 */
export function useLazyLoadObserver(options: UseLazyLoadObserverOptions): UseLazyLoadObserver {
  const { active, hasMore, isLoading, onLoadMore, rootMargin = '0px 0px 600px 0px' } = options

  const scrollContainer = ref<HTMLElement | null>(null)
  const loadMoreSentinel = ref<HTMLElement | null>(null)
  let observer: IntersectionObserver | null = null

  function disconnectObserver(): void {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  function maybeLoadMore(): void {
    if (hasMore() && !isLoading()) {
      onLoadMore()
    }
  }

  function setupObserver(): void {
    disconnectObserver()
    if (typeof IntersectionObserver === 'undefined') return
    if (!scrollContainer.value || !loadMoreSentinel.value) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          maybeLoadMore()
        }
      },
      {
        root: scrollContainer.value,
        // Prefetch ahead: trigger before the sentinel enters the viewport.
        rootMargin,
        threshold: 0,
      },
    )
    observer.observe(loadMoreSentinel.value)
  }

  // (Re)connect the observer whenever the host opens and its DOM is present.
  watch(
    active,
    async (isActive) => {
      if (isActive) {
        await nextTick()
        setupObserver()
      } else {
        disconnectObserver()
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(disconnectObserver)

  return { scrollContainer, loadMoreSentinel }
}

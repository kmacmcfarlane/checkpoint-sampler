import { enableAutoUnmount } from '@vue/test-utils'

// AC3: Automatically unmount all mounted Vue wrappers after each test.
// This prevents stale event listeners (e.g., keydown capture handlers in
// ImageLightbox) from leaking between tests and causing interference.
enableAutoUnmount(afterEach)

// AC4: Clear localStorage before each test to prevent cross-test contamination.
// Composables that read/write localStorage (usePresetPersistence, useTheme, etc.)
// must start each test with a clean slate.
beforeEach(() => {
  localStorage.clear()
})

// S-170: jsdom does not implement IntersectionObserver, which JobProgressPanel
// uses for prefetch-ahead lazy loading. Provide a no-op stub so components that
// register observers can mount in the test environment without crashing.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    constructor(
      _callback: IntersectionObserverCallback,
      _options?: IntersectionObserverInit,
    ) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
}

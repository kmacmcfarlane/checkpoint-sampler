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

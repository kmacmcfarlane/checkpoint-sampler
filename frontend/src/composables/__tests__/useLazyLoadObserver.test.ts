import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick, defineComponent, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useLazyLoadObserver, type UseLazyLoadObserver } from '../useLazyLoadObserver'

// jsdom does not implement IntersectionObserver, so useLazyLoadObserver's
// production `typeof IntersectionObserver === 'undefined'` guard would make
// the observer path a permanent no-op in tests. We inject a stub via the
// global — the composable itself is not changed, since IntersectionObserver
// is looked up as a global at call time.
class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  observed: Element[] = []
  disconnected = false

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    StubIntersectionObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.push(el)
  }

  unobserve(el: Element): void {
    this.observed = this.observed.filter(o => o !== el)
  }

  disconnect(): void {
    this.disconnected = true
  }

  trigger(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

interface Harness {
  wrapper: VueWrapper
  active: Ref<boolean>
  hasMore: ReturnType<typeof vi.fn>
  isLoading: ReturnType<typeof vi.fn>
  onLoadMore: ReturnType<typeof vi.fn>
  result: UseLazyLoadObserver
}

/**
 * Mount a wrapper component so the composable has access to the full Vue
 * component lifecycle (onBeforeUnmount in particular), matching the pattern
 * used for other composables with lifecycle hooks (see useCountdown.test.ts).
 */
function setup(initialActive = false): Harness {
  const active = ref(initialActive)
  const hasMore = vi.fn(() => true)
  const isLoading = vi.fn(() => false)
  const onLoadMore = vi.fn()
  let result!: UseLazyLoadObserver

  const Wrapper = defineComponent({
    setup() {
      result = useLazyLoadObserver({ active, hasMore, isLoading, onLoadMore })
      return { result }
    },
    mounted() {
      // Wire the template refs to the composable's refs so scrollContainer /
      // loadMoreSentinel are non-null once the component is mounted, exactly
      // as production components bind them via `ref="scrollContainer"`.
      result.scrollContainer.value = this.$el as HTMLElement
      result.loadMoreSentinel.value = (this.$el as HTMLElement).firstElementChild as HTMLElement
    },
    // A scroll container with a sentinel child, matching production usage.
    template: '<div><div /></div>',
  })

  const wrapper = mount(Wrapper)
  return { wrapper, active, hasMore, isLoading, onLoadMore, result }
}

beforeEach(() => {
  StubIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// active watch
// ---------------------------------------------------------------------------

describe('useLazyLoadObserver active watch', () => {
  // AC: active watch connects the observer once the DOM refs are present
  it('does not create an observer while inactive', () => {
    setup(false)
    expect(StubIntersectionObserver.instances).toHaveLength(0)
  })

  it('creates and observes the sentinel when active becomes true', async () => {
    const h = setup(false)
    h.active.value = true
    await nextTick() // flush the watch callback's own nextTick
    await nextTick()

    expect(StubIntersectionObserver.instances).toHaveLength(1)
    expect(StubIntersectionObserver.instances[0].observed).toEqual([h.result.loadMoreSentinel.value])
  })

  it('creates an observer immediately when mounted with active already true', async () => {
    const h = setup(true)
    await nextTick()
    await nextTick()

    expect(StubIntersectionObserver.instances).toHaveLength(1)
    expect(h.result.loadMoreSentinel.value).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// observer disconnect/reconnect
// ---------------------------------------------------------------------------

describe('useLazyLoadObserver disconnect/reconnect', () => {
  it('disconnects the observer when active becomes false', async () => {
    const h = setup(true)
    await nextTick()
    await nextTick()

    const first = StubIntersectionObserver.instances[0]
    expect(first.disconnected).toBe(false)

    h.active.value = false
    await nextTick()

    expect(first.disconnected).toBe(true)
  })

  it('disconnects the previous observer and creates a new one on reactivation', async () => {
    const h = setup(true)
    await nextTick()
    await nextTick()
    const first = StubIntersectionObserver.instances[0]

    h.active.value = false
    await nextTick()
    h.active.value = true
    await nextTick()
    await nextTick()

    expect(first.disconnected).toBe(true)
    expect(StubIntersectionObserver.instances).toHaveLength(2)
    expect(StubIntersectionObserver.instances[1].disconnected).toBe(false)
  })

  it('disconnects the observer on unmount', async () => {
    const h = setup(true)
    await nextTick()
    await nextTick()
    const observer = StubIntersectionObserver.instances[0]

    h.wrapper.unmount()

    expect(observer.disconnected).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// hasMore / isLoading guard
// ---------------------------------------------------------------------------

describe('useLazyLoadObserver hasMore/isLoading guard', () => {
  async function triggerAndSetup(hasMoreVal: boolean, isLoadingVal: boolean): Promise<Harness> {
    const h = setup(true)
    await nextTick()
    await nextTick()
    h.hasMore.mockReturnValue(hasMoreVal)
    h.isLoading.mockReturnValue(isLoadingVal)
    return h
  }

  // AC: hasMore/isLoading guard — only fires onLoadMore when both allow it
  it('calls onLoadMore when the sentinel intersects and more can be loaded', async () => {
    const h = await triggerAndSetup(true, false)
    StubIntersectionObserver.instances[0].trigger(true)
    expect(h.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not call onLoadMore when hasMore is false', async () => {
    const h = await triggerAndSetup(false, false)
    StubIntersectionObserver.instances[0].trigger(true)
    expect(h.onLoadMore).not.toHaveBeenCalled()
  })

  it('does not call onLoadMore when isLoading is true', async () => {
    const h = await triggerAndSetup(true, true)
    StubIntersectionObserver.instances[0].trigger(true)
    expect(h.onLoadMore).not.toHaveBeenCalled()
  })

  it('does not call onLoadMore when the sentinel is not intersecting', async () => {
    const h = await triggerAndSetup(true, false)
    StubIntersectionObserver.instances[0].trigger(false)
    expect(h.onLoadMore).not.toHaveBeenCalled()
  })
})

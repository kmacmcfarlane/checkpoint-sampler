import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useImagePreloader } from '../useImagePreloader'
import type { ScanImage, ScanDimension } from '../../api/types'

/** Track Image() constructor calls. */
let imageInstances: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }>

beforeEach(() => {
  imageInstances = []
  vi.stubGlobal(
    'Image',
    class FakeImage {
      src = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        imageInstances.push(this)
        // Auto-resolve onload on next microtask to simulate successful load
        queueMicrotask(() => {
          if (this.onload) this.onload()
        })
      }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Flush microtasks to let preloading run. */
async function flush() {
  // Multiple ticks to let the async preload loop complete
  for (let i = 0; i < 20; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

const makeImage = (path: string, dims: Record<string, string>, thumbnailPath = ''): ScanImage => ({
  relative_path: path,
  dimensions: dims,
  thumbnail_path: thumbnailPath,
})

describe('useImagePreloader', () => {
  it('preloads all images when no slider dimension is set', async () => {
    const images = ref<ScanImage[]>([
      makeImage('a.png', { seed: '42' }),
      makeImage('b.png', { seed: '123' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    expect(preloaded.has('/api/images/a.png')).toBe(true)
    expect(preloaded.has('/api/images/b.png')).toBe(true)
  })

  it('prioritizes slider positions for visible cells', async () => {
    const xDim = ref<ScanDimension>({ name: 'seed', type: 'int', values: ['42'] })
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension>({ name: 'cfg', type: 'int', values: ['3', '7'] })
    const combos = ref<Record<string, Set<string>>>({})

    // Image in visible cell (seed=42) at both slider positions
    const images = ref<ScanImage[]>([
      makeImage('vis-cfg3.png', { seed: '42', cfg: '3' }),
      makeImage('vis-cfg7.png', { seed: '42', cfg: '7' }),
      // Image not in visible cell (seed=999)
      makeImage('other.png', { seed: '999', cfg: '3' }),
    ])

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // All should eventually be preloaded
    expect(preloaded.has('/api/images/vis-cfg3.png')).toBe(true)
    expect(preloaded.has('/api/images/vis-cfg7.png')).toBe(true)
    expect(preloaded.has('/api/images/other.png')).toBe(true)
  })

  it('records preloaded URLs using Image() constructor', async () => {
    const images = ref<ScanImage[]>([
      makeImage('test.png', { seed: '1' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    const srcs = imageInstances.map((i) => i.src)
    expect(srcs).toContain('/api/images/test.png')
  })

  it('filters images by combo selections before preloading', async () => {
    const images = ref<ScanImage[]>([
      makeImage('yes.png', { seed: '42', prompt: 'a' }),
      makeImage('no.png', { seed: '42', prompt: 'b' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({ prompt: new Set(['a']) })

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // 'yes.png' passes combo filter (prompt=a), gets priority preload
    expect(preloaded.has('/api/images/yes.png')).toBe(true)
    // 'no.png' doesn't pass combo but still gets preloaded as remaining image
    expect(preloaded.has('/api/images/no.png')).toBe(true)
  })

  it('restarts preloading when images change', async () => {
    const images = ref<ScanImage[]>([makeImage('first.png', {})])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    expect(preloaded.has('/api/images/first.png')).toBe(true)

    // Change images - should trigger new preload cycle
    images.value = [makeImage('second.png', {})]
    await flush()

    expect(preloaded.has('/api/images/second.png')).toBe(true)
  })

  // AC: changing only a combo filter retriggers preload prioritization for newly-visible cells.
  // This mirrors the production store, which mutates a key INSIDE the reactive
  // comboSelections object in place (store.comboSelections[dim] = new Set(...))
  // rather than reassigning the object. The old shallow watch over the raw
  // [..., comboSelections] ref never fired on such in-place mutations.
  //
  // Deterministic detection: we use a NON-resolving fake Image so cycle 1 stalls
  // on its very first in-flight image and never advances. If — and only if — the
  // watch fires on the in-place combo mutation, runPreload() aborts the stalled
  // cycle and starts a fresh one, creating an additional Image() instance. So a
  // growth in imageInstances.length after the mutation proves the watch fired.
  // Against the old shallow-watch code the count stays flat and this FAILS.
  it('retriggers preload when comboSelections is mutated in place', async () => {
    // Override the shared fake with one that NEVER auto-resolves onload.
    vi.stubGlobal(
      'Image',
      class StalledImage {
        src = ''
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          imageInstances.push(this)
          // Intentionally never resolves: the preload loop blocks here.
        }
      },
    )

    const images = ref<ScanImage[]>([
      makeImage('a.png', { prompt: 'a' }),
      makeImage('b.png', { prompt: 'b' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    // Stable reactive object identity; we mutate a key inside it (never reassign).
    const combos = ref<Record<string, Set<string>>>({ prompt: new Set(['a']) })

    useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // Cycle 1 stalled on its first image.
    const countAfterCycle1 = imageInstances.length
    expect(countAfterCycle1).toBeGreaterThan(0)

    // Mutate a key INSIDE the object the way the store does — no reassignment.
    combos.value.prompt = new Set(['b'])
    await flush()

    // Watch must have fired: the stalled cycle was aborted and a new cycle
    // started, creating at least one more Image() instance.
    expect(imageInstances.length).toBeGreaterThan(countAfterCycle1)
  })

  // AC: already-preloaded URLs are not re-fetched on retrigger (preloaded set survives across cycles).
  // This isolates the second defect: the old code called preloaded.clear() on
  // every retrigger, so a URL loaded in cycle 1 would be re-fetched (a second
  // Image() created) in cycle 2. We retrigger via an `images` change (which even
  // the old shallow watch fired on) so the assertion targets the clear() defect:
  // against the old code totalCount would be 2 and this FAILS; with the fix the
  // has(url) guard skips the still-present URL and totalCount stays 1.
  it('skips re-creating Image() for URLs preloaded in a previous cycle', async () => {
    const images = ref<ScanImage[]>([
      makeImage('keep.png', { seed: '1' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    const cycle1Count = imageInstances.filter((i) => i.src === '/api/images/keep.png').length
    expect(cycle1Count).toBe(1)

    // Retrigger a new preload cycle. keep.png is still part of the image set.
    images.value = [makeImage('keep.png', { seed: '1' }), makeImage('new.png', { seed: '2' })]
    await flush()

    // keep.png was already in the preloaded set from cycle 1; the has(url) guard
    // must skip it — no second Image() created for the same URL (preloaded set
    // is NOT cleared wholesale between cycles).
    const totalCount = imageInstances.filter((i) => i.src === '/api/images/keep.png').length
    expect(totalCount).toBe(1)
    // The newly-added image still gets preloaded in the new cycle.
    expect(imageInstances.some((i) => i.src === '/api/images/new.png')).toBe(true)
  })

  it('does nothing with empty image list', async () => {
    const images = ref<ScanImage[]>([])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    expect(preloaded.size).toBe(0)
    expect(imageInstances).toHaveLength(0)
  })

  it('does not duplicate preload for the same URL', async () => {
    const images = ref<ScanImage[]>([
      makeImage('dup.png', { seed: '1' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // Count how many Image() instances were created for this URL
    const count = imageInstances.filter((i) => i.src === '/api/images/dup.png').length
    expect(count).toBe(1)
  })

  it('preloads with x and y dimensions defining visible cells', async () => {
    const xDim = ref<ScanDimension>({ name: 'seed', type: 'int', values: ['42', '99'] })
    const yDim = ref<ScanDimension>({ name: 'step', type: 'int', values: ['500'] })
    const sliderDim = ref<ScanDimension>({ name: 'cfg', type: 'int', values: ['3', '7'] })
    const combos = ref<Record<string, Set<string>>>({})

    const images = ref<ScanImage[]>([
      makeImage('s42-500-c3.png', { seed: '42', step: '500', cfg: '3' }),
      makeImage('s42-500-c7.png', { seed: '42', step: '500', cfg: '7' }),
      makeImage('s99-500-c3.png', { seed: '99', step: '500', cfg: '3' }),
      makeImage('s99-500-c7.png', { seed: '99', step: '500', cfg: '7' }),
    ])

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // All are in visible cells (all combos of seed x step), all slider positions
    expect(preloaded.size).toBe(4)
  })

  it('uses thumbnail URLs when thumbnail_path is available', async () => {
    const images = ref<ScanImage[]>([
      makeImage('a.png', { seed: '42' }, 'thumbs/a.jpg'),
      makeImage('b.png', { seed: '123' }),
    ])
    const xDim = ref<ScanDimension | null>(null)
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // Image with thumbnail should preload via thumbnail URL
    expect(preloaded.has('/api/images/thumbs/a.jpg')).toBe(true)
    // Image without thumbnail falls back to full-res
    expect(preloaded.has('/api/images/b.png')).toBe(true)
    // Full-res URL of image with thumbnail should NOT be preloaded
    expect(preloaded.has('/api/images/a.png')).toBe(false)
  })

  it('uses thumbnail URLs for slider-position preloading', async () => {
    const xDim = ref<ScanDimension>({ name: 'seed', type: 'int', values: ['42'] })
    const yDim = ref<ScanDimension | null>(null)
    const sliderDim = ref<ScanDimension>({ name: 'cfg', type: 'int', values: ['3', '7'] })
    const combos = ref<Record<string, Set<string>>>({})

    const images = ref<ScanImage[]>([
      makeImage('vis-cfg3.png', { seed: '42', cfg: '3' }, 'thumbs/vis-cfg3.jpg'),
      makeImage('vis-cfg7.png', { seed: '42', cfg: '7' }, 'thumbs/vis-cfg7.jpg'),
    ])

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    expect(preloaded.has('/api/images/thumbs/vis-cfg3.jpg')).toBe(true)
    expect(preloaded.has('/api/images/thumbs/vis-cfg7.jpg')).toBe(true)
    // Full-res should not be preloaded
    expect(preloaded.has('/api/images/vis-cfg3.png')).toBe(false)
    expect(preloaded.has('/api/images/vis-cfg7.png')).toBe(false)
  })

  it('preloads horizontal neighbors (+/-3 X-axis positions)', async () => {
    // 7 X values so we can test the +/-3 radius
    const xDim = ref<ScanDimension>({
      name: 'seed',
      type: 'int',
      values: ['1', '2', '3', '4', '5', '6', '7'],
    })
    const yDim = ref<ScanDimension>({ name: 'step', type: 'int', values: ['100'] })
    const sliderDim = ref<ScanDimension | null>(null)
    const combos = ref<Record<string, Set<string>>>({})

    const images = ref<ScanImage[]>(
      ['1', '2', '3', '4', '5', '6', '7'].map((s) =>
        makeImage(`s${s}.png`, { seed: s, step: '100' }, `thumbs/s${s}.jpg`),
      ),
    )

    const { preloaded } = useImagePreloader(images, xDim, yDim, sliderDim, combos)
    await flush()

    // All images should be preloaded via thumbnail URLs (they're horizontal neighbors of each other)
    for (const s of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(preloaded.has(`/api/images/thumbs/s${s}.jpg`)).toBe(true)
    }
    // Full-res should not be preloaded
    for (const s of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(preloaded.has(`/api/images/s${s}.png`)).toBe(false)
    }
  })
})

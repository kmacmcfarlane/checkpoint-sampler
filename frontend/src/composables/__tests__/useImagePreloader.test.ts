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

const makeImage = (path: string, dims: Record<string, string>): ScanImage => ({
  relative_path: path,
  dimensions: dims,
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
})

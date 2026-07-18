import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useImageCubeStore } from '../imageCube'
import type { ScanImage, ScanResult } from '../../api/types'

/** Helper to build a ScanImage with a default thumbnail_path. */
function img(partial: { relative_path: string; dimensions: Record<string, string> }): ScanImage {
  return { ...partial, thumbnail_path: '' }
}

/**
 * A 3-dimension cube: step (x-candidate), cfg (y-candidate), seed (slider-candidate).
 * Full cross product of 2×2×2 = 8 images so every (step, cfg, seed) coordinate exists.
 */
function makeCube(): ScanResult {
  const steps = ['500', '1000']
  const cfgs = ['7', '9']
  const seeds = ['42', '43']
  const images: ScanImage[] = []
  for (const step of steps) {
    for (const cfg of cfgs) {
      for (const seed of seeds) {
        images.push(
          img({
            relative_path: `run/step=${step}&cfg=${cfg}&seed=${seed}.png`,
            dimensions: { step, cfg, seed },
          }),
        )
      }
    }
  }
  return {
    images,
    dimensions: [
      { name: 'step', type: 'int', values: steps },
      { name: 'cfg', type: 'int', values: cfgs },
      { name: 'seed', type: 'int', values: seeds },
    ],
  }
}

describe('useImageCubeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ── Dimension / axis mapping ────────────────────────────────────────────
  describe('dimension and axis mapping', () => {
    // AC2: dimension/axis mapping — setScanResult seeds roles and filter modes
    it('initializes all dimensions to role "none" and derives dimensions/images', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      expect(store.dimensions.map((d) => d.name)).toEqual(['step', 'cfg', 'seed'])
      expect(store.images).toHaveLength(8)
      expect(store.assignments.get('step')).toBe('none')
      expect(store.assignments.get('cfg')).toBe('none')
      expect(store.assignments.get('seed')).toBe('none')
      expect(store.xDimension).toBeNull()
      expect(store.yDimension).toBeNull()
    })

    // AC2: dimension/axis mapping — multi-value dims default to 'single', single-value to 'hide'
    it('defaults single-value dimensions to filter mode "hide" and multi-value to "single"', () => {
      const store = useImageCubeStore()
      store.setScanResult({
        images: [img({ relative_path: 'a.png', dimensions: { step: '500', only: 'x' } })],
        dimensions: [
          { name: 'step', type: 'int', values: ['500', '1000'] },
          { name: 'only', type: 'string', values: ['x'] },
        ],
      })

      expect(store.getFilterMode('step')).toBe('single')
      expect(store.getFilterMode('only')).toBe('hide')
    })

    // AC2: X/Y assignment — assignRole maps a dimension to an axis
    it.each([
      ['x', (s: ReturnType<typeof useImageCubeStore>) => s.xDimension],
      ['y', (s: ReturnType<typeof useImageCubeStore>) => s.yDimension],
      ['slider', (s: ReturnType<typeof useImageCubeStore>) => s.sliderDimension],
      ['x_slider', (s: ReturnType<typeof useImageCubeStore>) => s.xSliderDimension],
      ['y_slider', (s: ReturnType<typeof useImageCubeStore>) => s.ySliderDimension],
    ] as const)('assigns dimension "step" to role %s', (role, getter) => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.assignRole('step', role)

      expect(getter(store)?.name).toBe('step')
      expect(store.assignments.get('step')).toBe(role)
      // Axis/slider assignment forces filter mode to 'multi'
      expect(store.getFilterMode('step')).toBe('multi')
    })

    // AC2: X/Y assignment — a role is exclusive; reassigning evicts the prior holder
    it('makes each axis role exclusive (reassigning x evicts the previous x holder)', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.assignRole('step', 'x')
      store.assignRole('cfg', 'x')

      expect(store.xDimension?.name).toBe('cfg')
      expect(store.assignments.get('step')).toBe('none')
      expect(store.getFilterMode('step')).toBe('single')
    })

    // AC2: X/Y assignment — the same dimension cannot hold two roles at once
    it('moves a dimension cleanly from one role to another', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.assignRole('step', 'x')
      store.assignRole('step', 'y')

      expect(store.xDimension).toBeNull()
      expect(store.yDimension?.name).toBe('step')
    })

    // AC2: X/Y assignment — dimensionAssignments reflects the current role map
    it('exposes dimensionAssignments for every dimension', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')

      const stepAssignment = store.dimensionAssignments.find((a) => a.dimensionName === 'step')
      expect(stepAssignment?.role).toBe('x')
      expect(store.dimensionAssignments).toHaveLength(3)
    })

    // AC2: assignRole is a no-op for an unknown dimension name
    it('ignores assignRole for an unknown dimension', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.assignRole('does-not-exist', 'x')

      expect(store.xDimension).toBeNull()
    })
  })

  // ── Filter application ──────────────────────────────────────────────────
  describe('filter application', () => {
    // AC2: filter application — a single combo selection narrows filteredImages
    it('filters images to a single selected value on one dimension', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.comboSelections = { step: new Set(['500']) }

      expect(store.filteredImages).toHaveLength(4)
      expect(store.filteredImages.every((i) => i.dimensions.step === '500')).toBe(true)
    })

    // AC2: filter application — combo selections across dimensions compose (AND)
    it('applies combo selections cumulatively across dimensions', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.comboSelections = {
        step: new Set(['500']),
        cfg: new Set(['7']),
      }

      expect(store.filteredImages).toHaveLength(2)
      expect(
        store.filteredImages.every((i) => i.dimensions.step === '500' && i.dimensions.cfg === '7'),
      ).toBe(true)
    })

    // AC2: filter application — a multi-value selection keeps every matching image
    it('keeps images matching any value in a multi-value selection', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.comboSelections = { seed: new Set(['42', '43']) }

      expect(store.filteredImages).toHaveLength(8)
    })

    // AC2: filter application — an empty selection set imposes no constraint
    it('treats an empty selection set as no filter', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.comboSelections = { step: new Set() }

      expect(store.filteredImages).toHaveLength(8)
    })

    // AC2: filter application — xValues/yValues restrict axis values to selections
    it('restricts xValues and yValues to the selected combo values', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')

      expect(store.xValues).toEqual(['500', '1000'])
      expect(store.yValues).toEqual(['7', '9'])

      store.comboSelections = { step: new Set(['1000']) }
      expect(store.xValues).toEqual(['1000'])
      // cfg has no selection, so yValues is the full set
      expect(store.yValues).toEqual(['7', '9'])
    })

    // AC2: filter application — setFilterMode is ignored while a dimension holds a role
    it('locks filter mode to "multi" for an axis-assigned dimension', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')

      store.setFilterMode('step', 'single')

      expect(store.getFilterMode('step')).toBe('multi')
    })

    // AC2: filter application — setFilterMode updates an unassigned dimension
    it('updates filter mode for an unassigned dimension', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.setFilterMode('seed', 'hide')

      expect(store.getFilterMode('seed')).toBe('hide')
    })
  })

  // ── Image-cube indexing ─────────────────────────────────────────────────
  describe('image-cube indexing', () => {
    // AC2: indexing — getImage resolves an (x, y) coordinate against the slider default
    it('indexes images by (x, y) coordinate using the default slider value', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      // defaultSliderValue falls back to the slider dimension's first value ('42')
      expect(store.defaultSliderValue).toBe('42')

      const cell = store.getImage('500', '7')
      expect(cell?.dimensions).toMatchObject({ step: '500', cfg: '7', seed: '42' })
      expect(cell?.relative_path).toBe('run/step=500&cfg=7&seed=42.png')
    })

    // AC2: indexing — imageIndex has one entry per visible cell
    it('builds one imageIndex entry per (x, y) cell', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      // 2 steps × 2 cfgs = 4 cells (slider collapses seed)
      expect(store.imageIndex.size).toBe(4)
      expect(store.gridColumnCount).toBe(2)
    })

    // AC2: indexing — the master slider re-selects which slice each cell shows
    it('re-indexes cells when the master slider changes the slice', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      store.setMasterSlider('43')

      expect(store.defaultSliderValue).toBe('43')
      expect(store.getImage('500', '7')?.dimensions.seed).toBe('43')
    })

    // AC2: indexing — per-cell slider override wins over the master default
    it('honors a per-cell slider override for a single cell', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      const key = store.cellKey('500', '7')
      store.setCellSlider(key, '43')

      expect(store.getImage('500', '7')?.dimensions.seed).toBe('43')
      // Other cells still follow the default
      expect(store.getImage('1000', '9')?.dimensions.seed).toBe('42')
    })

    // AC2: indexing — findImage looks up by an arbitrary dimension-value map
    it('finds an image by an exact dimension-value map', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      const found = store.findImage({ step: '1000', cfg: '9', seed: '43' })
      expect(found?.relative_path).toBe('run/step=1000&cfg=9&seed=43.png')
      expect(store.findImage({ step: '9999' })).toBeNull()
    })

    // AC2: indexing — getImagesBySliderValue maps every slider slice to a URL
    it('maps each slider value to an image URL for a cell', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      const bySlider = store.getImagesBySliderValue('500', '7')
      expect(Object.keys(bySlider).sort()).toEqual(['42', '43'])
      expect(bySlider['42']).toBe('/api/v1/images/run/step=500&cfg=7&seed=42.png')
    })

    // AC2: indexing — gridNavItems yields ordered, flattened cells for navigation
    it('produces gridNavItems for the full x/y grid', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      const items = store.gridNavItems
      expect(items).toHaveLength(4)
      expect(items.map((i) => i.cellKey)).toEqual(['500|7', '1000|7', '500|9', '1000|9'])
    })

    // AC2: indexing — lightbox focus cursor tracks the focused nav item
    it('tracks the focused cell and derives its image URL', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.assignRole('cfg', 'y')
      store.assignRole('seed', 'slider')

      store.focusCell('500|7')
      expect(store.focusedGridIndex).toBe(0)
      expect(store.focusedImage).toBe('/api/v1/images/run/step=500&cfg=7&seed=42.png')

      store.navigateGrid(1)
      expect(store.focusedCellKey).toBe('1000|7')

      store.unfocusCell()
      expect(store.focusedGridIndex).toBe(-1)
      expect(store.focusedImage).toBeNull()
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────────────
  describe('edge cases', () => {
    // AC2: edge case — no scan result at all
    it('exposes empty derivations before any scan result is set', () => {
      const store = useImageCubeStore()

      expect(store.dimensions).toEqual([])
      expect(store.images).toEqual([])
      expect(store.filteredImages).toEqual([])
      expect(store.xDimension).toBeNull()
      expect(store.imageIndex.size).toBe(0)
      expect(store.gridNavItems).toEqual([])
      expect(store.hasNoAxes).toBe(true)
      expect(store.getImage('500', '7')).toBeNull()
      expect(store.findImage({ step: '500' })).toBeNull()
    })

    // AC2: edge case — empty cube (dimensions declared but zero images)
    it('handles an empty cube with dimensions but no images', () => {
      const store = useImageCubeStore()
      store.setScanResult({
        images: [],
        dimensions: [{ name: 'step', type: 'int', values: ['500', '1000'] }],
      })
      store.assignRole('step', 'x')

      expect(store.xDimension?.name).toBe('step')
      expect(store.xValues).toEqual(['500', '1000'])
      expect(store.filteredImages).toEqual([])
      // No images means no cells even though axis values exist
      expect(store.gridNavItems).toEqual([])
      expect(store.getImage('500', undefined)).toBeNull()
    })

    // AC2: edge case — single-value dimension assigned to an axis
    it('handles a single-value dimension on the x axis', () => {
      const store = useImageCubeStore()
      store.setScanResult({
        images: [
          img({ relative_path: 'run/step=500.png', dimensions: { step: '500' } }),
        ],
        dimensions: [{ name: 'step', type: 'int', values: ['500'] }],
      })
      store.assignRole('step', 'x')

      expect(store.xValues).toEqual(['500'])
      expect(store.gridColumnCount).toBe(1)
      expect(store.getImage('500', undefined)?.relative_path).toBe('run/step=500.png')
      expect(store.gridNavItems).toHaveLength(1)
    })

    // AC2: edge case — flat mode (no axes assigned) lists all images
    it('renders flat-mode nav items when no axes are assigned', () => {
      const store = useImageCubeStore()
      store.setScanResult({
        images: [
          img({ relative_path: 'a.png', dimensions: { tag: 'a' } }),
          img({ relative_path: 'b.png', dimensions: { tag: 'b' } }),
        ],
        dimensions: [{ name: 'tag', type: 'string', values: ['a', 'b'] }],
      })

      expect(store.hasNoAxes).toBe(true)
      expect(store.gridNavItems).toHaveLength(2)
    })

    // AC2: edge case — $reset returns the store to its pristine state
    it('resets all state via $reset', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())
      store.assignRole('step', 'x')
      store.setMasterSlider('43')
      store.focusCell('500|7')

      store.$reset()

      expect(store.scanResult).toBeNull()
      expect(store.assignments.size).toBe(0)
      expect(store.masterSliderValue).toBe('')
      expect(store.focusedCellKey).toBeNull()
      expect(store.dimensions).toEqual([])
    })
  })

  // ── Incremental dataset mutation ────────────────────────────────────────
  describe('incremental dataset mutation', () => {
    // AC2: addImage introduces a new dimension value and image
    it('adds a new image and extends dimension values', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.addImage(
        img({ relative_path: 'run/step=2000&cfg=7&seed=42.png', dimensions: { step: '2000', cfg: '7', seed: '42' } }),
      )

      expect(store.images).toHaveLength(9)
      expect(store.dimensions.find((d) => d.name === 'step')?.values).toContain('2000')
    })

    // AC2: addImage replaces an existing image at the same relative_path
    it('replaces an image with the same relative_path instead of duplicating', () => {
      const store = useImageCubeStore()
      store.setScanResult(makeCube())

      store.addImage(
        img({ relative_path: 'run/step=500&cfg=7&seed=42.png', dimensions: { step: '500', cfg: '7', seed: '42' } }),
      )

      expect(store.images).toHaveLength(8)
    })

    // AC2: removeImage drops the image and prunes now-empty dimension values
    it('removes an image and rebuilds dimension values', () => {
      const store = useImageCubeStore()
      store.setScanResult({
        images: [
          img({ relative_path: 'run/step=500.png', dimensions: { step: '500' } }),
          img({ relative_path: 'run/step=1000.png', dimensions: { step: '1000' } }),
        ],
        dimensions: [{ name: 'step', type: 'int', values: ['500', '1000'] }],
      })

      store.removeImage('run/step=1000.png')

      expect(store.images).toHaveLength(1)
      expect(store.dimensions.find((d) => d.name === 'step')?.values).toEqual(['500'])
    })
  })
})

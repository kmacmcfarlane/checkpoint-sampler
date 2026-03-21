import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDimensionMapping, _resetForTesting } from '../useDimensionMapping'
import type { ScanResult } from '../../api/types'

function makeScanResult(overrides?: Partial<ScanResult>): ScanResult {
  return {
    images: [
      {
        relative_path: 'dir1/index=0&seed=42.png',
        dimensions: { index: '0', seed: '42', step: '500' },
      },
      {
        relative_path: 'dir1/index=1&seed=42.png',
        dimensions: { index: '1', seed: '42', step: '500' },
      },
      {
        relative_path: 'dir2/index=0&seed=42.png',
        dimensions: { index: '0', seed: '42', step: '1000' },
      },
    ],
    dimensions: [
      { name: 'index', type: 'int', values: ['0', '1'] },
      { name: 'seed', type: 'int', values: ['42'] },
      { name: 'step', type: 'int', values: ['500', '1000'] },
    ],
    ...overrides,
  }
}

describe('useDimensionMapping', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('setScanResult', () => {
    it('initializes all dimensions to none role', () => {
      const { setScanResult, assignments } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(assignments.value.size).toBe(3)
      expect(assignments.value.get('index')).toBe('none')
      expect(assignments.value.get('seed')).toBe('none')
      expect(assignments.value.get('step')).toBe('none')
    })

    it('exposes dimensions from scan result', () => {
      const { setScanResult, dimensions } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(dimensions.value).toHaveLength(3)
      expect(dimensions.value.map((d) => d.name)).toEqual(['index', 'seed', 'step'])
    })

    it('exposes images from scan result', () => {
      const { setScanResult, images } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(images.value).toHaveLength(3)
    })

    it('resets assignments when called again', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())
      assignRole('index', 'x')
      expect(assignments.value.get('index')).toBe('x')

      setScanResult(makeScanResult())
      expect(assignments.value.get('index')).toBe('none')
    })
  })

  describe('assignRole', () => {
    it('assigns a dimension to a role', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      expect(assignments.value.get('index')).toBe('x')
    })

    it('displaces existing dimension from unique role', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      assignRole('step', 'x')

      expect(assignments.value.get('step')).toBe('x')
      expect(assignments.value.get('index')).toBe('none')
    })

    it('allows multiple dimensions in none role', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      assignRole('step', 'y')
      // seed remains none
      expect(assignments.value.get('seed')).toBe('none')
      expect(assignments.value.get('index')).toBe('x')
      expect(assignments.value.get('step')).toBe('y')
    })

    it('ignores assignment for unknown dimension', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('nonexistent', 'x')
      expect(assignments.value.has('nonexistent')).toBe(false)
    })

    it('displaces existing slider when assigning new slider', () => {
      const { setScanResult, assignments, assignRole } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'slider')
      assignRole('step', 'slider')

      expect(assignments.value.get('step')).toBe('slider')
      expect(assignments.value.get('index')).toBe('none')
    })

    it('sets filter mode to multi when assigning x/y/slider role', () => {
      const { setScanResult, assignRole, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      expect(getFilterMode('index')).toBe('multi')

      assignRole('step', 'y')
      expect(getFilterMode('step')).toBe('multi')

      assignRole('seed', 'slider')
      expect(getFilterMode('seed')).toBe('multi')
    })

    it('reverts displaced dimension filter mode to single', () => {
      const { setScanResult, assignRole, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      expect(getFilterMode('index')).toBe('multi')

      assignRole('step', 'x') // displaces index
      expect(getFilterMode('index')).toBe('single')
      expect(getFilterMode('step')).toBe('multi')
    })

    it('sets filter mode to single when assigning none role', () => {
      const { setScanResult, assignRole, setFilterMode, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      setFilterMode('index', 'multi')
      expect(getFilterMode('index')).toBe('multi')

      assignRole('index', 'x')
      expect(getFilterMode('index')).toBe('multi')

      assignRole('index', 'none')
      expect(getFilterMode('index')).toBe('single')
    })
  })

  describe('filterModes', () => {
    it('initializes multi-value dimensions to single filter mode', () => {
      const { setScanResult, filterModes } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(filterModes.value.size).toBe(3)
      expect(filterModes.value.get('index')).toBe('single')
      expect(filterModes.value.get('step')).toBe('single')
    })

    it('initializes single-value dimensions to hide filter mode', () => {
      const { setScanResult, filterModes } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(filterModes.value.get('seed')).toBe('hide')
    })

    it('resets filter modes when setScanResult is called', () => {
      const { setScanResult, setFilterMode, filterModes } = useDimensionMapping()
      setScanResult(makeScanResult())
      setFilterMode('index', 'multi')

      setScanResult(makeScanResult())
      expect(filterModes.value.get('index')).toBe('single')
    })
  })

  describe('setFilterMode', () => {
    it('sets filter mode for unassigned dimension', () => {
      const { setScanResult, setFilterMode, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      setFilterMode('index', 'single')
      expect(getFilterMode('index')).toBe('single')

      setFilterMode('index', 'multi')
      expect(getFilterMode('index')).toBe('multi')

      setFilterMode('index', 'hide')
      expect(getFilterMode('index')).toBe('hide')
    })

    it('ignores filter mode changes for x/y/slider dimensions', () => {
      const { setScanResult, assignRole, setFilterMode, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      setFilterMode('index', 'hide')
      expect(getFilterMode('index')).toBe('multi')

      setFilterMode('index', 'single')
      expect(getFilterMode('index')).toBe('multi')
    })

    it('ignores unknown dimension names', () => {
      const { setScanResult, setFilterMode, filterModes } = useDimensionMapping()
      setScanResult(makeScanResult())

      setFilterMode('nonexistent', 'multi')
      expect(filterModes.value.has('nonexistent')).toBe(false)
    })
  })

  describe('getFilterMode', () => {
    it('returns single for unassigned multi-value dimensions by default', () => {
      const { setScanResult, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(getFilterMode('index')).toBe('single')
    })

    it('returns hide for unassigned single-value dimensions by default', () => {
      const { setScanResult, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(getFilterMode('seed')).toBe('hide')
    })

    it('returns multi for x/y/slider dimensions regardless of stored mode', () => {
      const { setScanResult, assignRole, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      expect(getFilterMode('index')).toBe('multi')
    })

    it('returns single for unknown dimensions', () => {
      const { setScanResult, getFilterMode } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(getFilterMode('nonexistent')).toBe('single')
    })
  })

  describe('computed dimensions by role', () => {
    it('returns null for unassigned x/y/slider/xSlider/ySlider', () => {
      const { setScanResult, xDimension, yDimension, sliderDimension, xSliderDimension, ySliderDimension } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(xDimension.value).toBeNull()
      expect(yDimension.value).toBeNull()
      expect(sliderDimension.value).toBeNull()
      expect(xSliderDimension.value).toBeNull()
      expect(ySliderDimension.value).toBeNull()
    })

    it('returns correct dimension for each role', () => {
      const { setScanResult, assignRole, xDimension, yDimension, sliderDimension } =
        useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x')
      assignRole('step', 'y')
      assignRole('seed', 'slider')

      expect(xDimension.value?.name).toBe('index')
      expect(yDimension.value?.name).toBe('step')
      expect(sliderDimension.value?.name).toBe('seed')
    })

    it('returns correct dimension for x_slider and y_slider roles', () => {
      const { setScanResult, assignRole, xSliderDimension, ySliderDimension } =
        useDimensionMapping()
      setScanResult(makeScanResult())

      assignRole('index', 'x_slider')
      assignRole('step', 'y_slider')

      expect(xSliderDimension.value?.name).toBe('index')
      expect(ySliderDimension.value?.name).toBe('step')
    })

    it('x_slider and y_slider are independent from x and y axis roles', () => {
      const { setScanResult, assignRole, xDimension, yDimension, xSliderDimension, ySliderDimension } =
        useDimensionMapping()
      setScanResult({
        images: [],
        dimensions: [
          { name: 'a', type: 'int', values: ['1', '2'] },
          { name: 'b', type: 'int', values: ['3', '4'] },
          { name: 'c', type: 'int', values: ['5', '6'] },
          { name: 'd', type: 'int', values: ['7', '8'] },
        ],
      })

      assignRole('a', 'x')
      assignRole('b', 'y')
      assignRole('c', 'x_slider')
      assignRole('d', 'y_slider')

      expect(xDimension.value?.name).toBe('a')
      expect(yDimension.value?.name).toBe('b')
      expect(xSliderDimension.value?.name).toBe('c')
      expect(ySliderDimension.value?.name).toBe('d')
    })
  })

  describe('dimensionAssignments', () => {
    it('returns assignments as array', () => {
      const { setScanResult, assignRole, dimensionAssignments } = useDimensionMapping()
      setScanResult(makeScanResult())
      assignRole('index', 'x')

      const found = dimensionAssignments.value.find((a) => a.dimensionName === 'index')
      expect(found?.role).toBe('x')
    })
  })

  describe('findImage', () => {
    it('finds image matching exact dimension values', () => {
      const { setScanResult, findImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      const img = findImage({ index: '0', seed: '42', step: '500' })
      expect(img?.relative_path).toBe('dir1/index=0&seed=42.png')
    })

    it('finds image matching partial dimension values', () => {
      const { setScanResult, findImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      const img = findImage({ index: '1' })
      expect(img?.relative_path).toBe('dir1/index=1&seed=42.png')
    })

    it('returns null when no image matches', () => {
      const { setScanResult, findImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      const img = findImage({ index: '99' })
      expect(img).toBeNull()
    })
  })

  describe('addImage', () => {
    it('adds a new image to the scan result', () => {
      const { setScanResult, images, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())
      expect(images.value).toHaveLength(3)

      addImage({
        relative_path: 'dir3/index=2&seed=42.png',
        dimensions: { index: '2', seed: '42', step: '1500' },
      })

      expect(images.value).toHaveLength(4)
      expect(images.value.find((i) => i.relative_path === 'dir3/index=2&seed=42.png')).toBeDefined()
    })

    it('adds new dimension values when image has unseen values', () => {
      const { setScanResult, dimensions, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      addImage({
        relative_path: 'dir3/index=5&seed=42.png',
        dimensions: { index: '5', seed: '42', step: '500' },
      })

      const indexDim = dimensions.value.find((d) => d.name === 'index')
      expect(indexDim?.values).toContain('5')
    })

    it('sorts new integer dimension values numerically', () => {
      const { setScanResult, dimensions, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      addImage({
        relative_path: 'dir3/index=5&seed=42.png',
        dimensions: { index: '5', seed: '42', step: '750' },
      })

      const stepDim = dimensions.value.find((d) => d.name === 'step')
      expect(stepDim?.values).toEqual(['500', '750', '1000'])
    })

    it('creates new dimensions for unseen dimension names', () => {
      const { setScanResult, dimensions, assignments, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      addImage({
        relative_path: 'dir3/index=0&seed=42&cfg=7.5.png',
        dimensions: { index: '0', seed: '42', step: '500', cfg: '7.5' },
      })

      const cfgDim = dimensions.value.find((d) => d.name === 'cfg')
      expect(cfgDim).toBeDefined()
      expect(cfgDim?.values).toEqual(['7.5'])
      expect(assignments.value.get('cfg')).toBe('none')
    })

    it('initializes filter mode to hide for new single-value dimensions', () => {
      const { setScanResult, filterModes, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      addImage({
        relative_path: 'dir3/index=0&seed=42&cfg=7.5.png',
        dimensions: { index: '0', seed: '42', step: '500', cfg: '7.5' },
      })

      expect(filterModes.value.get('cfg')).toBe('hide')
    })

    it('preserves existing dimension assignments', () => {
      const { setScanResult, assignments, assignRole, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())
      assignRole('index', 'x')
      assignRole('step', 'y')

      addImage({
        relative_path: 'dir3/index=5&seed=42.png',
        dimensions: { index: '5', seed: '42', step: '1500' },
      })

      expect(assignments.value.get('index')).toBe('x')
      expect(assignments.value.get('step')).toBe('y')
    })

    it('replaces existing image with same relative_path', () => {
      const { setScanResult, images, addImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      addImage({
        relative_path: 'dir1/index=0&seed=42.png',
        dimensions: { index: '0', seed: '42', step: '500', extra: 'new' },
      })

      expect(images.value).toHaveLength(3)
      const updated = images.value.find((i) => i.relative_path === 'dir1/index=0&seed=42.png')
      expect(updated?.dimensions['extra']).toBe('new')
    })

    it('does nothing when no scan result exists', () => {
      const { images, addImage } = useDimensionMapping()
      addImage({
        relative_path: 'dir/test.png',
        dimensions: { a: '1' },
      })
      expect(images.value).toHaveLength(0)
    })
  })

  describe('removeImage', () => {
    it('removes an image by relative path', () => {
      const { setScanResult, images, removeImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      removeImage('dir1/index=0&seed=42.png')
      expect(images.value).toHaveLength(2)
      expect(images.value.find((i) => i.relative_path === 'dir1/index=0&seed=42.png')).toBeUndefined()
    })

    it('removes dimension values no longer present in any image', () => {
      const { setScanResult, dimensions, removeImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      removeImage('dir2/index=0&seed=42.png')

      const stepDim = dimensions.value.find((d) => d.name === 'step')
      expect(stepDim?.values).toEqual(['500'])
      expect(stepDim?.values).not.toContain('1000')
    })

    it('preserves existing dimension assignments after removal', () => {
      const { setScanResult, assignments, assignRole, removeImage } = useDimensionMapping()
      setScanResult(makeScanResult())
      assignRole('index', 'x')
      assignRole('step', 'y')

      removeImage('dir2/index=0&seed=42.png')

      expect(assignments.value.get('index')).toBe('x')
      expect(assignments.value.get('step')).toBe('y')
    })

    it('removes dimension assignment when dimension disappears', () => {
      const { setScanResult, dimensions, assignments, removeImage } = useDimensionMapping()
      setScanResult({
        images: [
          { relative_path: 'a.png', dimensions: { x: '1', unique: 'val' } },
          { relative_path: 'b.png', dimensions: { x: '2' } },
        ],
        dimensions: [
          { name: 'x', type: 'int', values: ['1', '2'] },
          { name: 'unique', type: 'string', values: ['val'] },
        ],
      })

      removeImage('a.png')

      expect(dimensions.value.find((d) => d.name === 'unique')).toBeUndefined()
      expect(assignments.value.has('unique')).toBe(false)
    })

    it('removes filter mode when dimension disappears', () => {
      const { setScanResult, filterModes, removeImage } = useDimensionMapping()
      setScanResult({
        images: [
          { relative_path: 'a.png', dimensions: { x: '1', unique: 'val' } },
          { relative_path: 'b.png', dimensions: { x: '2' } },
        ],
        dimensions: [
          { name: 'x', type: 'int', values: ['1', '2'] },
          { name: 'unique', type: 'string', values: ['val'] },
        ],
      })

      removeImage('a.png')
      expect(filterModes.value.has('unique')).toBe(false)
    })

    it('does nothing for non-existent relative path', () => {
      const { setScanResult, images, removeImage } = useDimensionMapping()
      setScanResult(makeScanResult())

      removeImage('nonexistent.png')
      expect(images.value).toHaveLength(3)
    })

    it('does nothing when no scan result exists', () => {
      const { images, removeImage } = useDimensionMapping()
      removeImage('test.png')
      expect(images.value).toHaveLength(0)
    })
  })

  describe('singleton state (Pinia store shared across calls)', () => {
    it('returns the same state across multiple calls to useDimensionMapping', () => {
      const first = useDimensionMapping()
      first.setScanResult(makeScanResult())
      first.assignRole('index', 'x')
      first.setFilterMode('step', 'multi')

      const second = useDimensionMapping()

      expect(second.assignments.value.get('index')).toBe('x')
      expect(second.getFilterMode('step')).toBe('multi')
      expect(second.images.value).toHaveLength(3)
    })

    it('preserves role assignments when composable is re-invoked', () => {
      const first = useDimensionMapping()
      first.setScanResult(makeScanResult())
      first.assignRole('index', 'x')
      first.assignRole('step', 'y')
      first.assignRole('seed', 'slider')

      const second = useDimensionMapping()

      expect(second.xDimension.value?.name).toBe('index')
      expect(second.yDimension.value?.name).toBe('step')
      expect(second.sliderDimension.value?.name).toBe('seed')
    })

    it('preserves filter modes when composable is re-invoked', () => {
      const first = useDimensionMapping()
      first.setScanResult(makeScanResult())
      first.setFilterMode('index', 'hide')

      const second = useDimensionMapping()

      expect(second.filterModes.value.get('index')).toBe('hide')
    })

    it('shares mutations: changes via second instance are visible in first', () => {
      const first = useDimensionMapping()
      first.setScanResult(makeScanResult())

      const second = useDimensionMapping()
      second.assignRole('index', 'x')

      expect(first.assignments.value.get('index')).toBe('x')
    })

    it('_resetForTesting clears all state', () => {
      const first = useDimensionMapping()
      first.setScanResult(makeScanResult())
      first.assignRole('index', 'x')

      _resetForTesting()

      const second = useDimensionMapping()
      expect(second.scanResult.value).toBeNull()
      expect(second.assignments.value.size).toBe(0)
      expect(second.filterModes.value.size).toBe(0)
    })
  })
})

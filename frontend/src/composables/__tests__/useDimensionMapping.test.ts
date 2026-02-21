import { describe, it, expect } from 'vitest'
import { useDimensionMapping } from '../useDimensionMapping'
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
  })

  describe('computed dimensions by role', () => {
    it('returns null for unassigned x/y/slider', () => {
      const { setScanResult, xDimension, yDimension, sliderDimension } = useDimensionMapping()
      setScanResult(makeScanResult())

      expect(xDimension.value).toBeNull()
      expect(yDimension.value).toBeNull()
      expect(sliderDimension.value).toBeNull()
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

      // Remove all images with step=1000
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
      // Create a scan result where removing images can eliminate a dimension
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
})

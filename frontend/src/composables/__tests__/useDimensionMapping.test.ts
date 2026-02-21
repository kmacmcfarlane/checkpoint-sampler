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
})

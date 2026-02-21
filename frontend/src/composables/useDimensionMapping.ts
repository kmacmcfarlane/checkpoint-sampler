import { ref, computed } from 'vue'
import type {
  ScanResult,
  ScanDimension,
  ScanImage,
  DimensionRole,
  DimensionAssignment,
} from '../api/types'

/**
 * Composable managing dimension-to-role assignments and the derived grid state.
 *
 * Dimensions default to 'none' role. The user can reassign any dimension
 * to exactly one of: x, y, slider, none. At most one dimension may be
 * assigned to x, y, or slider at a time. Combo filters are always shown
 * for every dimension regardless of role assignment.
 */
export function useDimensionMapping() {
  const scanResult = ref<ScanResult | null>(null)
  const assignments = ref<Map<string, DimensionRole>>(new Map())

  /** Replace the current scan data and reset assignments. */
  function setScanResult(result: ScanResult) {
    scanResult.value = result
    assignments.value = new Map()
    for (const dim of result.dimensions) {
      assignments.value.set(dim.name, 'none')
    }
  }

  /** All discovered dimensions from the scan. */
  const dimensions = computed<ScanDimension[]>(() => {
    return scanResult.value?.dimensions ?? []
  })

  /** All images from the scan. */
  const images = computed<ScanImage[]>(() => {
    return scanResult.value?.images ?? []
  })

  /** Current dimension assignments as an array. */
  const dimensionAssignments = computed<DimensionAssignment[]>(() => {
    const result: DimensionAssignment[] = []
    for (const [dimensionName, role] of assignments.value) {
      result.push({ dimensionName, role })
    }
    return result
  })

  /**
   * Assign a dimension to a role. Enforces uniqueness for x, y, and slider:
   * if another dimension already holds that role, it is moved to 'none'.
   */
  function assignRole(dimensionName: string, role: DimensionRole) {
    if (!assignments.value.has(dimensionName)) return

    // For x, y, slider — only one dimension may hold that role
    if (role !== 'none') {
      for (const [name, existingRole] of assignments.value) {
        if (existingRole === role && name !== dimensionName) {
          assignments.value.set(name, 'none')
        }
      }
    }
    assignments.value.set(dimensionName, role)
    // Trigger reactivity by replacing the map
    assignments.value = new Map(assignments.value)
  }

  /** Get the dimension assigned to a specific role (null if none). */
  function getDimensionForRole(role: DimensionRole): ScanDimension | null {
    for (const [name, r] of assignments.value) {
      if (r === role) {
        const dim = dimensions.value.find((d) => d.name === name)
        if (dim) return dim
      }
    }
    return null
  }

  /** The dimension assigned to X axis, or null. */
  const xDimension = computed(() => getDimensionForRole('x'))

  /** The dimension assigned to Y axis, or null. */
  const yDimension = computed(() => getDimensionForRole('y'))

  /** The dimension assigned to slider, or null. */
  const sliderDimension = computed(() => getDimensionForRole('slider'))

  /**
   * Find the image matching a given set of dimension values.
   * Returns the first image whose dimensions match all specified key-value pairs.
   */
  function findImage(dimensionValues: Record<string, string>): ScanImage | null {
    for (const img of images.value) {
      let match = true
      for (const [key, value] of Object.entries(dimensionValues)) {
        if (img.dimensions[key] !== value) {
          match = false
          break
        }
      }
      if (match) return img
    }
    return null
  }

  return {
    scanResult,
    dimensions,
    images,
    assignments,
    dimensionAssignments,
    xDimension,
    yDimension,
    sliderDimension,
    setScanResult,
    assignRole,
    findImage,
  }
}

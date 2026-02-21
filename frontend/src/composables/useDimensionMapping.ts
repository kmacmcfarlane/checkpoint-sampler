import { ref, computed } from 'vue'
import type {
  ScanResult,
  ScanDimension,
  ScanImage,
  DimensionRole,
  DimensionAssignment,
} from '../api/types'

/**
 * Sort dimension values: integer dimensions sorted numerically, string dimensions lexicographically.
 */
function sortDimensionValues(values: string[], type: 'int' | 'string'): string[] {
  const sorted = [...values]
  if (type === 'int') {
    sorted.sort((a, b) => {
      const ai = parseInt(a, 10)
      const bi = parseInt(b, 10)
      if (isNaN(ai) || isNaN(bi)) return a.localeCompare(b)
      return ai - bi
    })
  } else {
    sorted.sort()
  }
  return sorted
}

/**
 * Infer dimension type from a value: if it parses as an integer, it's 'int', otherwise 'string'.
 */
function inferDimensionType(value: string): 'int' | 'string' {
  return /^-?\d+$/.test(value) ? 'int' : 'string'
}

/**
 * Update existing dimensions with new values from an image's dimension map.
 * Adds new dimensions if they don't exist yet. Returns a new dimensions array.
 */
function updateDimensionValues(
  existingDimensions: ScanDimension[],
  imageDims: Record<string, string>,
): ScanDimension[] {
  const dimMap = new Map(existingDimensions.map((d) => [d.name, d]))

  for (const [name, value] of Object.entries(imageDims)) {
    const existing = dimMap.get(name)
    if (existing) {
      if (!existing.values.includes(value)) {
        const newValues = sortDimensionValues([...existing.values, value], existing.type)
        dimMap.set(name, { ...existing, values: newValues })
      }
    } else {
      const type = inferDimensionType(value)
      dimMap.set(name, { name, type, values: [value] })
    }
  }

  return Array.from(dimMap.values())
}

/**
 * Rebuild dimension values from a list of images, preserving dimension types from
 * the original dimensions. Removes dimensions that have no values in the remaining images.
 */
function rebuildDimensions(
  originalDimensions: ScanDimension[],
  remainingImages: ScanImage[],
): ScanDimension[] {
  // Collect all dimension values from remaining images
  const dimValueSets = new Map<string, Set<string>>()
  for (const img of remainingImages) {
    for (const [name, value] of Object.entries(img.dimensions)) {
      let set = dimValueSets.get(name)
      if (!set) {
        set = new Set()
        dimValueSets.set(name, set)
      }
      set.add(value)
    }
  }

  // Preserve type info from original dimensions, rebuild values
  const typeMap = new Map(originalDimensions.map((d) => [d.name, d.type]))
  const result: ScanDimension[] = []

  for (const [name, valueSet] of dimValueSets) {
    const type = typeMap.get(name) ?? 'string'
    const values = sortDimensionValues(Array.from(valueSet), type)
    result.push({ name, type, values })
  }

  return result
}

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

  /**
   * Add an image to the current scan result incrementally.
   * Updates dimension values if the image introduces new values.
   * Preserves existing dimension assignments.
   */
  function addImage(image: ScanImage): void {
    if (!scanResult.value) return

    // Check for duplicate by relative_path
    const existing = scanResult.value.images.findIndex(
      (img) => img.relative_path === image.relative_path,
    )
    const newImages =
      existing >= 0
        ? scanResult.value.images.map((img, i) => (i === existing ? image : img))
        : [...scanResult.value.images, image]

    // Update dimension values
    const newDimensions = updateDimensionValues(scanResult.value.dimensions, image.dimensions)

    // Trigger reactivity
    scanResult.value = {
      images: newImages,
      dimensions: newDimensions,
    }

    // Ensure new dimensions get an assignment
    for (const dim of newDimensions) {
      if (!assignments.value.has(dim.name)) {
        assignments.value.set(dim.name, 'none')
        assignments.value = new Map(assignments.value)
      }
    }
  }

  /**
   * Remove an image from the current scan result by relative path.
   * Recalculates dimension values from remaining images.
   * Preserves existing dimension assignments.
   */
  function removeImage(relativePath: string): void {
    if (!scanResult.value) return

    const newImages = scanResult.value.images.filter((img) => img.relative_path !== relativePath)
    if (newImages.length === scanResult.value.images.length) return // not found

    // Rebuild dimension values from remaining images
    const newDimensions = rebuildDimensions(scanResult.value.dimensions, newImages)

    // Trigger reactivity
    scanResult.value = {
      images: newImages,
      dimensions: newDimensions,
    }

    // Remove assignments for dimensions that no longer exist
    let assignmentsChanged = false
    for (const [name] of assignments.value) {
      if (!newDimensions.some((d) => d.name === name)) {
        assignments.value.delete(name)
        assignmentsChanged = true
      }
    }
    if (assignmentsChanged) {
      assignments.value = new Map(assignments.value)
    }
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
    addImage,
    removeImage,
  }
}

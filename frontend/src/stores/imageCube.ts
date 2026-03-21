import { ref, computed } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  ScanResult,
  ScanDimension,
  ScanImage,
  DimensionRole,
  DimensionAssignment,
  FilterMode,
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
 * Central store for the multi-dimensional image dataset.
 *
 * Owns the image cube (scan result + dimension roles), current viewing position
 * (all slider values), combo filter selections, and the lightbox focus cursor.
 * All grid derivations (filtered images, visible axis values, grid nav items)
 * are computed getters — always reactive, never stale.
 */
export const useImageCubeStore = defineStore('imageCube', () => {
  // ── Dataset state ──────────────────────────────────────────────────────
  const scanResult = ref<ScanResult | null>(null)
  const assignments = ref<Map<string, DimensionRole>>(new Map())
  const filterModes = ref<Map<string, FilterMode>>(new Map())

  // ── Derived dataset state ──────────────────────────────────────────────
  const dimensions = computed<ScanDimension[]>(() => scanResult.value?.dimensions ?? [])
  const images = computed<ScanImage[]>(() => scanResult.value?.images ?? [])

  const dimensionAssignments = computed<DimensionAssignment[]>(() => {
    const result: DimensionAssignment[] = []
    for (const [dimensionName, role] of assignments.value) {
      result.push({ dimensionName, role })
    }
    return result
  })

  function getDimensionForRole(role: DimensionRole): ScanDimension | null {
    for (const [name, r] of assignments.value) {
      if (r === role) {
        const dim = dimensions.value.find((d) => d.name === name)
        if (dim) return dim
      }
    }
    return null
  }

  const xDimension = computed(() => getDimensionForRole('x'))
  const yDimension = computed(() => getDimensionForRole('y'))
  const sliderDimension = computed(() => getDimensionForRole('slider'))
  const xSliderDimension = computed(() => getDimensionForRole('x_slider'))
  const ySliderDimension = computed(() => getDimensionForRole('y_slider'))

  // ── Dataset actions ────────────────────────────────────────────────────

  function setScanResult(result: ScanResult) {
    scanResult.value = result
    assignments.value = new Map()
    filterModes.value = new Map()
    for (const dim of result.dimensions) {
      assignments.value.set(dim.name, 'none')
      filterModes.value.set(dim.name, dim.values.length <= 1 ? 'hide' : 'single')
    }
  }

  function assignRole(dimensionName: string, role: DimensionRole) {
    if (!assignments.value.has(dimensionName)) return

    if (role !== 'none') {
      for (const [name, existingRole] of assignments.value) {
        if (existingRole === role && name !== dimensionName) {
          assignments.value.set(name, 'none')
          filterModes.value.set(name, 'single')
        }
      }
    }
    assignments.value.set(dimensionName, role)

    if (role !== 'none') {
      filterModes.value.set(dimensionName, 'multi')
    } else {
      filterModes.value.set(dimensionName, 'single')
    }

    assignments.value = new Map(assignments.value)
    filterModes.value = new Map(filterModes.value)
  }

  function setFilterMode(dimensionName: string, mode: FilterMode) {
    if (!filterModes.value.has(dimensionName)) return
    const role = assignments.value.get(dimensionName)
    if (role && role !== 'none') return
    filterModes.value.set(dimensionName, mode)
    filterModes.value = new Map(filterModes.value)
  }

  function getFilterMode(dimensionName: string): FilterMode {
    const role = assignments.value.get(dimensionName)
    if (role && role !== 'none') return 'multi'
    return filterModes.value.get(dimensionName) ?? 'single'
  }

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

  function addImage(image: ScanImage): void {
    if (!scanResult.value) return

    const existing = scanResult.value.images.findIndex(
      (img) => img.relative_path === image.relative_path,
    )
    const newImages =
      existing >= 0
        ? scanResult.value.images.map((img, i) => (i === existing ? image : img))
        : [...scanResult.value.images, image]

    const newDimensions = updateDimensionValues(scanResult.value.dimensions, image.dimensions)

    scanResult.value = {
      images: newImages,
      dimensions: newDimensions,
    }

    for (const dim of newDimensions) {
      if (!assignments.value.has(dim.name)) {
        assignments.value.set(dim.name, 'none')
        filterModes.value.set(dim.name, dim.values.length <= 1 ? 'hide' : 'single')
        assignments.value = new Map(assignments.value)
        filterModes.value = new Map(filterModes.value)
      }
    }
  }

  function removeImage(relativePath: string): void {
    if (!scanResult.value) return

    const newImages = scanResult.value.images.filter((img) => img.relative_path !== relativePath)
    if (newImages.length === scanResult.value.images.length) return

    const newDimensions = rebuildDimensions(scanResult.value.dimensions, newImages)

    scanResult.value = {
      images: newImages,
      dimensions: newDimensions,
    }

    let changed = false
    for (const [name] of assignments.value) {
      if (!newDimensions.some((d) => d.name === name)) {
        assignments.value.delete(name)
        filterModes.value.delete(name)
        changed = true
      }
    }
    if (changed) {
      assignments.value = new Map(assignments.value)
      filterModes.value = new Map(filterModes.value)
    }
  }

  // ── Grid position state ────────────────────────────────────────────────
  const comboSelections = ref<Record<string, Set<string>>>({})
  const masterSliderValue = ref('')
  const xSliderValue = ref('')
  const ySliderValue = ref('')
  const cellSliderOverrides = ref<Record<string, string>>({})

  const defaultSliderValue = computed(() => {
    if (masterSliderValue.value) return masterSliderValue.value
    return sliderDimension.value?.values[0] ?? ''
  })

  const currentXSliderValue = computed(() => {
    if (xSliderValue.value) return xSliderValue.value
    return xSliderDimension.value?.values[0] ?? ''
  })

  const currentYSliderValue = computed(() => {
    if (ySliderValue.value) return ySliderValue.value
    return ySliderDimension.value?.values[0] ?? ''
  })

  function setMasterSlider(value: string) {
    masterSliderValue.value = value
    // Clear per-cell overrides so all cells follow the master
    for (const key of Object.keys(cellSliderOverrides.value)) {
      delete cellSliderOverrides.value[key]
    }
  }

  function setCellSlider(cellKey: string, value: string) {
    cellSliderOverrides.value[cellKey] = value
  }

  function setXSlider(value: string) {
    xSliderValue.value = value
    const dim = xSliderDimension.value
    if (dim) {
      comboSelections.value[dim.name] = new Set([value])
    }
  }

  function setYSlider(value: string) {
    ySliderValue.value = value
    const dim = ySliderDimension.value
    if (dim) {
      comboSelections.value[dim.name] = new Set([value])
    }
  }

  // ── Grid derivations ──────────────────────────────────────────────────

  const filteredImages = computed<ScanImage[]>(() => {
    return images.value.filter((img) => {
      for (const [dimName, selected] of Object.entries(comboSelections.value)) {
        const imgValue = img.dimensions[dimName]
        if (selected.size > 0 && imgValue !== undefined && !selected.has(imgValue)) {
          return false
        }
      }
      return true
    })
  })

  const xValues = computed<string[]>(() => {
    const dim = xDimension.value
    if (!dim) return []
    const selections = comboSelections.value[dim.name]
    if (!selections || selections.size === 0) return dim.values
    return dim.values.filter((v) => selections.has(v))
  })

  const yValues = computed<string[]>(() => {
    const dim = yDimension.value
    if (!dim) return []
    const selections = comboSelections.value[dim.name]
    if (!selections || selections.size === 0) return dim.values
    return dim.values.filter((v) => selections.has(v))
  })

  function cellKey(xVal: string | undefined, yVal: string | undefined): string {
    return `${xVal ?? ''}|${yVal ?? ''}`
  }

  function getCellSliderValue(xVal: string | undefined, yVal: string | undefined): string {
    const key = cellKey(xVal, yVal)
    return cellSliderOverrides.value[key] ?? defaultSliderValue.value
  }

  const imageIndex = computed<Map<string, ScanImage>>(() => {
    const index = new Map<string, ScanImage>()
    const xDimName = xDimension.value?.name
    const yDimName = yDimension.value?.name

    for (const img of filteredImages.value) {
      const xVal = xDimName ? img.dimensions[xDimName] : undefined
      const yVal = yDimName ? img.dimensions[yDimName] : undefined

      if (sliderDimension.value) {
        const sliderDimName = sliderDimension.value.name
        const sliderVal = img.dimensions[sliderDimName]
        const key = cellKey(xVal, yVal)
        const expectedSliderVal = cellSliderOverrides.value[key] ?? defaultSliderValue.value
        if (sliderVal !== undefined && sliderVal !== expectedSliderVal) {
          continue
        }
      }

      const key = cellKey(xVal, yVal)
      if (!index.has(key)) {
        index.set(key, img)
      }
    }
    return index
  })

  function getImage(xVal: string | undefined, yVal: string | undefined): ScanImage | null {
    return imageIndex.value.get(cellKey(xVal, yVal)) ?? null
  }

  function getImagesBySliderValue(
    xVal: string | undefined,
    yVal: string | undefined,
  ): Record<string, string> {
    if (!sliderDimension.value) return {}
    const sliderDimName = sliderDimension.value.name
    const xDimName = xDimension.value?.name
    const yDimName = yDimension.value?.name
    const result: Record<string, string> = {}
    for (const img of filteredImages.value) {
      const imgXVal = xDimName ? img.dimensions[xDimName] : undefined
      const imgYVal = yDimName ? img.dimensions[yDimName] : undefined
      if (imgXVal !== xVal || imgYVal !== yVal) continue
      const sliderVal = img.dimensions[sliderDimName]
      if (sliderVal !== undefined && !(sliderVal in result)) {
        result[sliderVal] = `/api/images/${img.relative_path}`
      }
    }
    return result
  }

  const hasNoAxes = computed(() => !xDimension.value && !yDimension.value)

  const gridNavItems = computed(() => {
    const items: { imageUrl: string; cellKey: string; sliderValues: string[]; currentSliderValue: string; imagesBySliderValue: Record<string, string> }[] = []
    const sliderVals = sliderDimension.value?.values ?? []

    if (hasNoAxes.value) {
      // Flat mode
      const sliderDimName = sliderDimension.value?.name
      const expectedVal = sliderDimName ? getCellSliderValue(undefined, undefined) : undefined
      const flat = sliderDimName
        ? filteredImages.value.filter((img) => {
            const val = img.dimensions[sliderDimName]
            return val === undefined || val === expectedVal
          })
        : filteredImages.value
      for (const img of flat) {
        items.push({
          imageUrl: `/api/images/${img.relative_path}`,
          cellKey: '|',
          sliderValues: sliderVals,
          currentSliderValue: getCellSliderValue(undefined, undefined),
          imagesBySliderValue: getImagesBySliderValue(undefined, undefined),
        })
      }
    } else if (xDimension.value && yDimension.value) {
      for (const yVal of yValues.value) {
        for (const xVal of xValues.value) {
          const img = getImage(xVal, yVal)
          if (!img) continue
          items.push({
            imageUrl: `/api/images/${img.relative_path}`,
            cellKey: cellKey(xVal, yVal),
            sliderValues: sliderVals,
            currentSliderValue: getCellSliderValue(xVal, yVal),
            imagesBySliderValue: getImagesBySliderValue(xVal, yVal),
          })
        }
      }
    } else if (xDimension.value) {
      for (const xVal of xValues.value) {
        const img = getImage(xVal, undefined)
        if (!img) continue
        items.push({
          imageUrl: `/api/images/${img.relative_path}`,
          cellKey: cellKey(xVal, undefined),
          sliderValues: sliderVals,
          currentSliderValue: getCellSliderValue(xVal, undefined),
          imagesBySliderValue: getImagesBySliderValue(xVal, undefined),
        })
      }
    } else if (yDimension.value) {
      for (const yVal of yValues.value) {
        const img = getImage(undefined, yVal)
        if (!img) continue
        items.push({
          imageUrl: `/api/images/${img.relative_path}`,
          cellKey: cellKey(undefined, yVal),
          sliderValues: sliderVals,
          currentSliderValue: getCellSliderValue(undefined, yVal),
          imagesBySliderValue: getImagesBySliderValue(undefined, yVal),
        })
      }
    }

    return items
  })

  const gridColumnCount = computed(() => {
    return xDimension.value ? xValues.value.length : 0
  })

  // ── Lightbox cursor ────────────────────────────────────────────────────
  const focusedCellKey = ref<string | null>(null)

  const focusedGridIndex = computed(() => {
    if (!focusedCellKey.value) return -1
    const idx = gridNavItems.value.findIndex((item) => item.cellKey === focusedCellKey.value)
    return idx >= 0 ? idx : -1
  })

  const focusedNavItem = computed(() => {
    if (focusedGridIndex.value < 0) return null
    return gridNavItems.value[focusedGridIndex.value] ?? null
  })

  /**
   * The key derivation: resolves the focused cell's image URL from
   * the current dimension positions. Always reactive — no stale snapshots.
   */
  const focusedImage = computed<string | null>(() => {
    if (!focusedCellKey.value) return null
    // Parse axis values from cellKey
    const sepIdx = focusedCellKey.value.indexOf('|')
    const xAxisVal = focusedCellKey.value.substring(0, sepIdx)
    const yAxisVal = focusedCellKey.value.substring(sepIdx + 1)

    // Build full dimension query
    const query: Record<string, string> = {}
    if (xDimension.value && xAxisVal) query[xDimension.value.name] = xAxisVal
    if (yDimension.value && yAxisVal) query[yDimension.value.name] = yAxisVal
    if (xSliderDimension.value) query[xSliderDimension.value.name] = currentXSliderValue.value
    if (ySliderDimension.value) query[ySliderDimension.value.name] = currentYSliderValue.value
    if (sliderDimension.value) {
      const key = cellKey(xAxisVal || undefined, yAxisVal || undefined)
      query[sliderDimension.value.name] = cellSliderOverrides.value[key] ?? defaultSliderValue.value
    }

    const img = findImage(query)
    return img ? `/api/images/${img.relative_path}` : null
  })

  function focusCell(key: string) {
    focusedCellKey.value = key
  }

  function unfocusCell() {
    focusedCellKey.value = null
  }

  function navigateGrid(newIndex: number) {
    const items = gridNavItems.value
    if (items.length === 0) return
    const clamped = Math.max(0, Math.min(newIndex, items.length - 1))
    const item = items[clamped]
    if (item) {
      focusedCellKey.value = item.cellKey
    }
  }

  /** Reset all state for test isolation (setup stores don't get $reset automatically). */
  function $reset() {
    scanResult.value = null
    assignments.value = new Map()
    filterModes.value = new Map()
    comboSelections.value = {}
    masterSliderValue.value = ''
    xSliderValue.value = ''
    ySliderValue.value = ''
    cellSliderOverrides.value = {}
    focusedCellKey.value = null
  }

  // ── Public API ─────────────────────────────────────────────────────────
  return {
    $reset,
    // Dataset state
    scanResult,
    assignments,
    filterModes,
    // Derived dataset
    dimensions,
    images,
    dimensionAssignments,
    xDimension,
    yDimension,
    sliderDimension,
    xSliderDimension,
    ySliderDimension,
    // Dataset actions
    setScanResult,
    assignRole,
    setFilterMode,
    getFilterMode,
    findImage,
    addImage,
    removeImage,
    // Grid position state
    comboSelections,
    masterSliderValue,
    xSliderValue,
    ySliderValue,
    cellSliderOverrides,
    // Grid position derived
    defaultSliderValue,
    currentXSliderValue,
    currentYSliderValue,
    // Grid position actions
    setMasterSlider,
    setCellSlider,
    setXSlider,
    setYSlider,
    // Grid derivations
    filteredImages,
    xValues,
    yValues,
    imageIndex,
    gridNavItems,
    gridColumnCount,
    hasNoAxes,
    cellKey,
    getCellSliderValue,
    getImage,
    getImagesBySliderValue,
    // Lightbox cursor
    focusedCellKey,
    focusedGridIndex,
    focusedNavItem,
    focusedImage,
    focusCell,
    unfocusCell,
    navigateGrid,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useImageCubeStore, import.meta.hot))
}

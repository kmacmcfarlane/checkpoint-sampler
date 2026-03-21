import { useImageCubeStore } from '../stores/imageCube'
import type {
  ScanDimension,
  ScanImage,
  DimensionRole,
  DimensionAssignment,
  FilterMode,
} from '../api/types'
import type { Ref } from 'vue'
import { computed } from 'vue'

/**
 * Thin wrapper around useImageCubeStore for backward compatibility.
 * All state and logic has been migrated to the Pinia store.
 *
 * @deprecated Use useImageCubeStore() directly in new code.
 */
export function useDimensionMapping() {
  const store = useImageCubeStore()

  return {
    scanResult: computed({
      get: () => store.scanResult,
      set: (val) => { store.scanResult = val },
    }),
    dimensions: computed<ScanDimension[]>(() => store.dimensions),
    images: computed<ScanImage[]>(() => store.images),
    assignments: computed({
      get: () => store.assignments,
      set: (val) => { store.assignments = val },
    }) as Ref<Map<string, DimensionRole>>,
    filterModes: computed({
      get: () => store.filterModes,
      set: (val) => { store.filterModes = val },
    }) as Ref<Map<string, FilterMode>>,
    dimensionAssignments: computed<DimensionAssignment[]>(() => store.dimensionAssignments),
    xDimension: computed(() => store.xDimension),
    yDimension: computed(() => store.yDimension),
    sliderDimension: computed(() => store.sliderDimension),
    xSliderDimension: computed(() => store.xSliderDimension),
    ySliderDimension: computed(() => store.ySliderDimension),
    setScanResult: store.setScanResult,
    assignRole: store.assignRole,
    setFilterMode: store.setFilterMode,
    getFilterMode: store.getFilterMode,
    findImage: store.findImage,
    addImage: store.addImage,
    removeImage: store.removeImage,
  }
}

/**
 * Reset store state for test isolation.
 * @internal
 */
export function _resetForTesting(): void {
  const store = useImageCubeStore()
  store.$reset()
}

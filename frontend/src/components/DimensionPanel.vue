<script setup lang="ts">
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import type { DimensionRole, FilterMode, ScanDimension, UnifiedDimensionMode } from '../api/types'

const props = defineProps<{
  dimensions: ScanDimension[]
  assignments: Map<string, DimensionRole>
  filterModes: Map<string, FilterMode>
}>()

// update:mode: Emitted when the user changes a dimension's unified mode.
//   Payload: dimension name and new UnifiedDimensionMode ('x'|'y'|'slider'|'single'|'multi'|'hide').
//   The parent decomposes this into role assignment and filter mode changes.
const emit = defineEmits<{
  'update:mode': [dimensionName: string, mode: UnifiedDimensionMode]
}>()

/** Base options for the unified selector. Axis roles are dynamically filtered
 *  based on mutual exclusion (only one dimension can hold X, Y, or Slider). */
const baseOptions: Array<{ value: UnifiedDimensionMode; label: string; group: string }> = [
  { value: 'x', label: 'X Axis', group: 'Axis' },
  { value: 'y', label: 'Y Axis', group: 'Axis' },
  { value: 'slider', label: 'Slider', group: 'Axis' },
  { value: 'single', label: 'Single', group: 'Filter' },
  { value: 'multi', label: 'Multi', group: 'Filter' },
  { value: 'hide', label: 'Hide', group: 'Filter' },
]

/** Returns true when the dimension has only one unique value and therefore
 *  provides no variation. Single-value dimensions are sorted to the bottom
 *  of the list and their selectors are disabled. */
function isSingleValue(dim: ScanDimension): boolean {
  return dim.values.length <= 1
}

/** Dimensions sorted so that single-value dimensions appear at the bottom.
 *  Within each group the original order from the backend is preserved. */
const sortedDimensions = computed<ScanDimension[]>(() => {
  const multi = props.dimensions.filter((d) => !isSingleValue(d))
  const single = props.dimensions.filter((d) => isSingleValue(d))
  return [...multi, ...single]
})

/** Axis roles currently assigned to other dimensions, keyed by role. */
const assignedAxes = computed(() => {
  const map = new Map<string, string>() // role -> dimension name
  for (const [name, role] of props.assignments) {
    if (role === 'x' || role === 'y' || role === 'slider') {
      map.set(role, name)
    }
  }
  return map
})

/**
 * Build the options available for a specific dimension.
 * Axis roles already held by other dimensions are excluded from the list,
 * but the axis role held by THIS dimension is always shown.
 */
function getOptionsForDimension(dimensionName: string) {
  return baseOptions.filter((opt) => {
    // Filter-mode options are always available
    if (opt.value === 'single' || opt.value === 'multi' || opt.value === 'hide') return true
    // Axis option: show if unassigned or assigned to this dimension
    const holder = assignedAxes.value.get(opt.value)
    return !holder || holder === dimensionName
  })
}

/** Derive the unified mode value for a dimension from its role and filter mode.
 *  Single-value dimensions always display as 'hide' regardless of stored filter mode. */
function getUnifiedMode(dimensionName: string): UnifiedDimensionMode {
  const dim = props.dimensions.find((d) => d.name === dimensionName)
  if (dim && isSingleValue(dim)) return 'hide'
  const role = props.assignments.get(dimensionName) ?? 'none'
  if (role === 'x' || role === 'y' || role === 'slider') return role
  return props.filterModes.get(dimensionName) ?? 'single'
}

function onModeChange(dimensionName: string, value: string | null) {
  if (value !== null) {
    emit('update:mode', dimensionName, value as UnifiedDimensionMode)
  }
}
</script>

<template>
  <div class="dimension-panel" v-if="dimensions.length > 0">
    <h3>Dimensions</h3>
    <div class="dimension-list">
      <div
        v-for="dim in sortedDimensions"
        :key="dim.name"
        class="dimension-row"
        :class="{ 'dimension-row--disabled': isSingleValue(dim) }"
        :data-testid="`dimension-row-${dim.name}`"
      >
        <span class="dimension-name">{{ dim.name }}</span>
        <NSelect
          :value="getUnifiedMode(dim.name)"
          :options="getOptionsForDimension(dim.name)"
          :disabled="isSingleValue(dim)"
          size="small"
          class="dimension-mode-select"
          :aria-label="`Mode for ${dim.name}`"
          @update:value="(v: string | null) => onModeChange(dim.name, v)"
        />
        <span class="dimension-values">{{ dim.values.length }} values</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dimension-panel {
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin-bottom: 1rem;
}

.dimension-panel h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
}

.dimension-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dimension-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.dimension-name {
  font-weight: 600;
  min-width: 80px;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dimension-mode-select {
  min-width: 100px;
  flex-shrink: 1;
}

.dimension-values {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.dimension-row--disabled {
  opacity: 0.45;
}

.dimension-row--disabled .dimension-name {
  color: var(--text-secondary);
}
</style>

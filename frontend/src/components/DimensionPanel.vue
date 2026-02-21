<script setup lang="ts">
import { NSelect } from 'naive-ui'
import type { DimensionRole, FilterMode, ScanDimension } from '../api/types'

const props = defineProps<{
  dimensions: ScanDimension[]
  assignments: Map<string, DimensionRole>
  filterModes: Map<string, FilterMode>
}>()

const emit = defineEmits<{
  assign: [dimensionName: string, role: DimensionRole]
  'update:filterMode': [dimensionName: string, mode: FilterMode]
}>()

const roleOptions = [
  { value: 'x', label: 'X Axis' },
  { value: 'y', label: 'Y Axis' },
  { value: 'slider', label: 'Slider' },
  { value: 'none', label: 'None' },
]

const filterModeOptions = [
  { value: 'hide', label: 'Hide' },
  { value: 'single', label: 'Single' },
  { value: 'multi', label: 'Multi' },
]

function onRoleChange(dimensionName: string, value: string | null) {
  if (value !== null) {
    emit('assign', dimensionName, value as DimensionRole)
  }
}

function onFilterModeChange(dimensionName: string, value: string | null) {
  if (value !== null) {
    emit('update:filterMode', dimensionName, value as FilterMode)
  }
}

function getRole(dimensionName: string): DimensionRole {
  return props.assignments.get(dimensionName) ?? 'none'
}

function getFilterMode(dimensionName: string): FilterMode {
  const role = getRole(dimensionName)
  if (role !== 'none') return 'multi'
  return props.filterModes.get(dimensionName) ?? 'hide'
}

function isFilterModeDisabled(dimensionName: string): boolean {
  const role = getRole(dimensionName)
  return role !== 'none'
}
</script>

<template>
  <div class="dimension-panel" v-if="dimensions.length > 0">
    <h3>Dimensions</h3>
    <div class="dimension-list">
      <div
        v-for="dim in dimensions"
        :key="dim.name"
        class="dimension-row"
      >
        <span class="dimension-name">{{ dim.name }}</span>
        <NSelect
          :value="getRole(dim.name)"
          :options="roleOptions"
          size="small"
          class="dimension-role-select"
          :aria-label="`Role for ${dim.name}`"
          @update:value="(v: string | null) => onRoleChange(dim.name, v)"
        />
        <NSelect
          :value="getFilterMode(dim.name)"
          :options="filterModeOptions"
          :disabled="isFilterModeDisabled(dim.name)"
          size="small"
          class="dimension-filter-select"
          :aria-label="`Filter mode for ${dim.name}`"
          @update:value="(v: string | null) => onFilterModeChange(dim.name, v)"
        />
        <span class="dimension-values">{{ dim.values.length }} values</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dimension-panel {
  padding: 0.5rem;
  border: 1px solid var(--border-color, #e0e0e0);
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

.dimension-role-select {
  min-width: 100px;
  flex-shrink: 1;
}

.dimension-filter-select {
  min-width: 80px;
  flex-shrink: 1;
}

.dimension-values {
  color: var(--text-secondary, #666);
  font-size: 0.75rem;
}
</style>

<script setup lang="ts">
import { NSelect } from 'naive-ui'
import type { DimensionRole, ScanDimension } from '../api/types'

const props = defineProps<{
  dimensions: ScanDimension[]
  assignments: Map<string, DimensionRole>
}>()

const emit = defineEmits<{
  assign: [dimensionName: string, role: DimensionRole]
}>()

const roleOptions = [
  { value: 'x', label: 'X Axis' },
  { value: 'y', label: 'Y Axis' },
  { value: 'slider', label: 'Slider' },
  { value: 'none', label: 'None' },
]

function onRoleChange(dimensionName: string, value: string | null) {
  if (value !== null) {
    emit('assign', dimensionName, value as DimensionRole)
  }
}

function getRole(dimensionName: string): DimensionRole {
  return props.assignments.get(dimensionName) ?? 'none'
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
          style="min-width: 120px"
          :aria-label="`Role for ${dim.name}`"
          @update:value="(v: string | null) => onRoleChange(dim.name, v)"
        />
        <span class="dimension-values">{{ dim.values.length }} values</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dimension-panel {
  padding: 0.5rem;
  border: 1px solid #e0e0e0;
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
}

.dimension-name {
  font-weight: 600;
  min-width: 120px;
}

.dimension-values {
  color: #666;
  font-size: 0.75rem;
}
</style>

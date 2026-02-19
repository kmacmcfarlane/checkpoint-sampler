<script setup lang="ts">
import type { DimensionRole, ScanDimension } from '../api/types'

const props = defineProps<{
  dimensions: ScanDimension[]
  assignments: Map<string, DimensionRole>
}>()

const emit = defineEmits<{
  assign: [dimensionName: string, role: DimensionRole]
}>()

const roles: { value: DimensionRole; label: string }[] = [
  { value: 'x', label: 'X Axis' },
  { value: 'y', label: 'Y Axis' },
  { value: 'slider', label: 'Slider' },
  { value: 'combo', label: 'Combo Filter' },
]

function onRoleChange(dimensionName: string, event: Event) {
  const target = event.target as HTMLSelectElement
  emit('assign', dimensionName, target.value as DimensionRole)
}

function getRole(dimensionName: string): DimensionRole {
  return props.assignments.get(dimensionName) ?? 'combo'
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
        <select
          :aria-label="`Role for ${dim.name}`"
          :value="getRole(dim.name)"
          @change="onRoleChange(dim.name, $event)"
        >
          <option
            v-for="role in roles"
            :key="role.value"
            :value="role.value"
          >
            {{ role.label }}
          </option>
        </select>
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

.dimension-row select {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.dimension-values {
  color: #666;
  font-size: 0.75rem;
}
</style>

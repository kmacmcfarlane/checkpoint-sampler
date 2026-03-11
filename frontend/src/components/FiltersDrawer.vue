<script setup lang="ts">
import { NDrawer, NDrawerContent } from 'naive-ui'
import DimensionFilter from './DimensionFilter.vue'
import type { FilterMode } from '../api/types'

interface DimensionInfo {
  name: string
  values: string[]
}

defineProps<{
  show: boolean
  dimensions: DimensionInfo[]
  comboSelections: Record<string, Set<string>>
  /** Function that returns the filter mode for a given dimension name. */
  getFilterMode: (name: string) => FilterMode
}>()

// update:show: Emitted when the drawer is opened or closed. Payload: boolean visibility state.
// filter-update: Emitted when a filter selection changes. Payload: dimension name and new selected Set.
const emit = defineEmits<{
  'update:show': [value: boolean]
  'filter-update': [dimensionName: string, selected: Set<string>]
}>()

function onUpdateShow(value: boolean) {
  emit('update:show', value)
}

function onFilterUpdate(dimensionName: string, selected: Set<string>) {
  emit('filter-update', dimensionName, selected)
}
</script>

<template>
  <NDrawer
    :show="show"
    placement="right"
    :width="320"
    :auto-focus="false"
    @update:show="onUpdateShow"
  >
    <NDrawerContent title="Filters" closable>
      <div class="filters-drawer__content" data-testid="filters-drawer-content">
        <DimensionFilter
          v-for="dim in dimensions"
          :key="dim.name"
          :dimension-name="dim.name"
          :values="dim.values"
          :selected="comboSelections[dim.name] ?? new Set()"
          :filter-mode="getFilterMode(dim.name)"
          :always-expanded="true"
          @update="onFilterUpdate"
        />
        <p v-if="dimensions.filter(d => getFilterMode(d.name) !== 'hide').length === 0" class="filters-drawer__empty">
          No active filters. Assign filter modes to dimensions in the Controls panel.
        </p>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.filters-drawer__content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filters-drawer__empty {
  color: var(--text-secondary);
  font-size: 0.875rem;
  text-align: center;
  padding: 1rem 0;
}
</style>

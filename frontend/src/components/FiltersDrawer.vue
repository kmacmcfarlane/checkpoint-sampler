<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
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

/** Drawer width in px. */
const drawerWidth = ref(320)
const dragging = ref(false)

const MIN_WIDTH = 200
const MAX_WIDTH_VW = 0.8
const NARROW_BREAKPOINT = 600

/** Effective drawer width: full viewport on narrow screens, otherwise resizable width. */
const effectiveWidth = computed(() => {
  if (window.innerWidth < NARROW_BREAKPOINT) return window.innerWidth
  return drawerWidth.value
})

/** Start drag resize from the left edge handle. */
function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  // Drawer is on the right side: width = viewport width - mouse X position
  const newWidth = window.innerWidth - e.clientX
  const maxWidth = window.innerWidth * MAX_WIDTH_VW
  drawerWidth.value = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))
}

function onMouseUp() {
  dragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

onUnmounted(() => {
  // Clean up drag listeners in case unmounted during drag
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})

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
    :width="effectiveWidth"
    :auto-focus="false"
    @update:show="onUpdateShow"
  >
    <div
      class="resize-handle"
      data-testid="filters-drawer-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize filters drawer"
      @mousedown="onResizeStart"
    />
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
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
  background: transparent;
}

.resize-handle:hover {
  background: var(--accent-color);
  opacity: 0.3;
}

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

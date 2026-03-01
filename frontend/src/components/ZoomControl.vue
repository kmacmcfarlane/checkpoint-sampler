<script setup lang="ts">
import { computed } from 'vue'
import { NSlider } from 'naive-ui'

const props = defineProps<{
  /** Current cell size in pixels (both width and height are the same). */
  cellSize: number
}>()

// update:cellSize: Emitted when the zoom slider is dragged. Payload: new cell size in pixels (100–600).
const emit = defineEmits<{
  'update:cellSize': [size: number]
}>()

// Zoom range: 100px to 600px
const MIN_SIZE = 100
const MAX_SIZE = 600

const currentSize = computed({
  get: () => props.cellSize,
  set: (value: number) => emit('update:cellSize', value),
})

function onUpdate(value: number) {
  emit('update:cellSize', value)
}
</script>

<template>
  <div class="zoom-control" role="group" aria-label="Grid cell zoom control">
    <label class="zoom-control__label">
      Zoom
    </label>
    <NSlider
      :value="currentSize"
      :min="MIN_SIZE"
      :max="MAX_SIZE"
      :step="10"
      :tooltip="false"
      class="zoom-control__slider"
      aria-label="Grid cell zoom"
      @update:value="onUpdate"
    />
    <span class="zoom-control__value">{{ currentSize }}px</span>
  </div>
</template>

<style scoped>
.zoom-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 0.5rem;
  width: 100%;
}

.zoom-control__label {
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
}

.zoom-control__slider {
  flex: 1;
  min-width: 0;
}

.zoom-control__value {
  font-size: 0.875rem;
  color: var(--text-secondary);
  white-space: nowrap;
  min-width: 50px;
  text-align: right;
}

@media (max-width: 767px) {
  .zoom-control {
    flex-wrap: wrap;
  }

  .zoom-control__slider {
    order: 2;
    flex-basis: 100%;
  }
}
</style>

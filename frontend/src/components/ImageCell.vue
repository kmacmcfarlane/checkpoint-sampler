<script setup lang="ts">
import { computed } from 'vue'
import type { DebugCellInfo } from './types'
import DebugOverlay from './DebugOverlay.vue'

const props = defineProps<{
  relativePath: string | null
  /** Pre-generated JPEG thumbnail path (relative to sample dir). When provided, the grid
   *  uses the thumbnail URL instead of the full-resolution image for faster loading.
   *  The click event still emits the full-resolution URL for the lightbox. */
  thumbnailPath?: string
  /** Ordered slider values for this cell. When provided, arrow keys step through them. */
  sliderValues?: string[]
  /** Currently active slider value for this cell. */
  currentSliderValue?: string
  /** When provided, renders a debug info overlay on the cell. */
  debugInfo?: DebugCellInfo
}>()

// click: Emitted when the image is clicked. Payload: the full image URL string.
// slider:change: Emitted when the user presses an arrow key to step through slider values. Payload: the new slider value string.
const emit = defineEmits<{
  click: [imageUrl: string]
  'slider:change': [value: string]
}>()

/** Full-resolution URL — used by the lightbox and as fallback when no thumbnail. */
const imageUrl = computed(() => {
  if (!props.relativePath) return null
  return `/api/images/${props.relativePath}`
})

/** URL used for the grid <img> element. Prefers the thumbnail when available. */
const gridImageUrl = computed(() => {
  if (props.thumbnailPath) return `/api/images/${props.thumbnailPath}`
  return imageUrl.value
})

function onClick() {
  if (imageUrl.value) {
    emit('click', imageUrl.value)
  }
}

function onKeydown(event: KeyboardEvent) {
  const values = props.sliderValues
  if (!values || values.length === 0) return

  const current = props.currentSliderValue ?? ''
  const idx = values.indexOf(current)
  const currentIdx = idx >= 0 ? idx : 0

  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault()
    const nextIdx = currentIdx < values.length - 1 ? currentIdx + 1 : 0
    emit('slider:change', values[nextIdx])
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault()
    const prevIdx = currentIdx > 0 ? currentIdx - 1 : values.length - 1
    emit('slider:change', values[prevIdx])
  }
}
</script>

<template>
  <div
    class="image-cell"
    :class="{ 'image-cell--empty': !relativePath }"
    :tabindex="sliderValues && sliderValues.length > 0 ? 0 : undefined"
    @click="onClick"
    @keydown="onKeydown"
  >
    <img
      v-if="gridImageUrl"
      :src="gridImageUrl"
      :alt="relativePath ?? ''"
      loading="lazy"
      :data-full-src="imageUrl ?? undefined"
    />
    <div v-else class="image-cell__placeholder">
      No image
    </div>
    <DebugOverlay v-if="debugInfo" :info="debugInfo" />
  </div>
</template>

<style scoped>
.image-cell {
  position: relative;
  border: 1px solid var(--border-color);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.image-cell:focus {
  outline: 2px solid var(--accent-color);
  outline-offset: -2px;
}

.image-cell img {
  max-width: 100%;
  height: auto;
  display: block;
  cursor: pointer;
}

.image-cell--empty {
  background-color: var(--bg-surface);
}

.image-cell__placeholder {
  color: var(--text-secondary);
  font-size: 0.875rem;
  padding: 1rem;
  text-align: center;
}
</style>

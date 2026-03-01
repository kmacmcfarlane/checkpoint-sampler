<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  relativePath: string | null
  /** Ordered slider values for this cell. When provided, arrow keys step through them. */
  sliderValues?: string[]
  /** Currently active slider value for this cell. */
  currentSliderValue?: string
}>()

// click: Emitted when the image is clicked. Payload: the full image URL string.
// slider:change: Emitted when the user presses an arrow key to step through slider values. Payload: the new slider value string.
const emit = defineEmits<{
  click: [imageUrl: string]
  'slider:change': [value: string]
}>()

const imageUrl = computed(() => {
  if (!props.relativePath) return null
  return `/api/images/${props.relativePath}`
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
      v-if="imageUrl"
      :src="imageUrl"
      :alt="relativePath ?? ''"
      loading="lazy"
    />
    <div v-else class="image-cell__placeholder">
      No image
    </div>
  </div>
</template>

<style scoped>
.image-cell {
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

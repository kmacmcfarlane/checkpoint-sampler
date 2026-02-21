<script setup lang="ts">
import { computed } from 'vue'
import { NSlider } from 'naive-ui'

const props = defineProps<{
  /** Ordered values to cycle through. */
  values: string[]
  /** Currently selected value. */
  currentValue: string
  /** Label for accessibility (e.g. dimension name). */
  label: string
}>()

const emit = defineEmits<{
  change: [value: string]
}>()

const currentIndex = computed(() => {
  const idx = props.values.indexOf(props.currentValue)
  return idx >= 0 ? idx : 0
})

function onUpdate(idx: number) {
  if (idx >= 0 && idx < props.values.length) {
    emit('change', props.values[idx])
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.values.length === 0) return
  const idx = currentIndex.value
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault()
    if (idx > 0) {
      emit('change', props.values[idx - 1])
    }
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (idx < props.values.length - 1) {
      emit('change', props.values[idx + 1])
    }
  }
}
</script>

<template>
  <div class="slider-bar" tabindex="0" @keydown="onKeydown" :aria-label="label">
    <NSlider
      :value="currentIndex"
      :min="0"
      :max="Math.max(0, values.length - 1)"
      :step="1"
      :tooltip="false"
      style="flex: 1"
      @update:value="onUpdate"
    />
    <span class="slider-bar__value">{{ currentValue }}</span>
  </div>
</template>

<style scoped>
.slider-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.slider-bar__value {
  font-size: 0.75rem;
  color: var(--text-secondary, #666);
  min-width: 3rem;
  text-align: right;
}
</style>

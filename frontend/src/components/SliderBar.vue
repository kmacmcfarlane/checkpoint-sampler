<script setup lang="ts">
import { computed } from 'vue'

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

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  const idx = Number(target.value)
  if (idx >= 0 && idx < props.values.length) {
    emit('change', props.values[idx])
  }
}
</script>

<template>
  <div class="slider-bar">
    <input
      type="range"
      :min="0"
      :max="values.length - 1"
      :value="currentIndex"
      :aria-label="label"
      :aria-valuetext="currentValue"
      class="slider-bar__input"
      @input="onInput"
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

.slider-bar__input {
  flex: 1;
  cursor: pointer;
}

.slider-bar__value {
  font-size: 0.75rem;
  color: #666;
  min-width: 3rem;
  text-align: right;
}
</style>

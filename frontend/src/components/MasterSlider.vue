<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** Ordered values to cycle through. */
  values: string[]
  /** Currently selected value for the master slider. */
  currentValue: string
  /** Dimension name for labelling. */
  dimensionName: string
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
  <div class="master-slider" role="group" :aria-label="`Master ${dimensionName} slider`" tabindex="0" @keydown="onKeydown">
    <label class="master-slider__label">
      {{ dimensionName }}
    </label>
    <input
      type="range"
      :min="0"
      :max="values.length - 1"
      :value="currentIndex"
      :aria-label="`Master ${dimensionName}`"
      :aria-valuetext="currentValue"
      class="master-slider__input"
      @input="onInput"
    />
    <span class="master-slider__value">{{ currentValue }}</span>
  </div>
</template>

<style scoped>
.master-slider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 0.5rem;
}

.master-slider__label {
  font-weight: 600;
  font-size: 0.875rem;
  min-width: 5rem;
}

.master-slider__input {
  flex: 1;
  max-width: 400px;
  cursor: pointer;
}

.master-slider__value {
  font-size: 0.875rem;
  color: #666;
  min-width: 4rem;
  text-align: right;
}
</style>

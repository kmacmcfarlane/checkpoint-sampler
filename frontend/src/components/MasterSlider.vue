<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'

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

// Playback state
const playing = ref(false)
const loop = ref(false)
const speedMs = ref(1000)
let timerId: ReturnType<typeof setInterval> | null = null

const speedOptions = [
  { label: '0.5s', value: 500 },
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 },
]

function startPlayback() {
  if (props.values.length <= 1) return
  playing.value = true
  scheduleNext()
}

function stopPlayback() {
  playing.value = false
  clearTimer()
}

function togglePlayback() {
  if (playing.value) {
    stopPlayback()
  } else {
    startPlayback()
  }
}

function clearTimer() {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

function scheduleNext() {
  clearTimer()
  timerId = setInterval(() => {
    advance()
  }, speedMs.value)
}

function advance() {
  const idx = currentIndex.value
  if (idx < props.values.length - 1) {
    emit('change', props.values[idx + 1])
  } else if (loop.value) {
    emit('change', props.values[0])
  } else {
    stopPlayback()
  }
}

function onSpeedChange(event: Event) {
  const target = event.target as HTMLSelectElement
  speedMs.value = Number(target.value)
}

// Restart interval when speed changes during playback
watch(speedMs, () => {
  if (playing.value) {
    scheduleNext()
  }
})

// Stop playback when values change (e.g. dimension switch)
watch(() => props.values, () => {
  stopPlayback()
})

onBeforeUnmount(() => {
  clearTimer()
})
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
    <div class="master-slider__playback">
      <button
        class="master-slider__play-btn"
        :aria-label="playing ? 'Pause playback' : 'Play playback'"
        @click="togglePlayback"
      >{{ playing ? 'Pause' : 'Play' }}</button>
      <label class="master-slider__loop">
        <input type="checkbox" :checked="loop" @change="loop = !loop" aria-label="Loop playback" />
        Loop
      </label>
      <select
        class="master-slider__speed"
        :value="speedMs"
        aria-label="Playback speed"
        @change="onSpeedChange"
      >
        <option v-for="opt in speedOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>
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
  flex-wrap: wrap;
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

.master-slider__playback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.master-slider__play-btn {
  padding: 0.25rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  background: #f5f5f5;
}

.master-slider__play-btn:hover {
  background: #e0e0e0;
}

.master-slider__loop {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  cursor: pointer;
}

.master-slider__speed {
  font-size: 0.8125rem;
  padding: 0.125rem 0.25rem;
  cursor: pointer;
}
</style>

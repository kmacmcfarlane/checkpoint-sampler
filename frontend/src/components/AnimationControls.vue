<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { NButton, NCheckbox, NSelect } from 'naive-ui'

const props = defineProps<{
  /** Ordered values to cycle through during playback. */
  values: string[]
  /** Currently selected value (used to determine current position for advance). */
  currentValue: string
  /** Dimension name for labelling. */
  dimensionName: string
}>()

// change: Emitted when playback advances to a new value.
// Payload: the new string value from the values array.
const emit = defineEmits<{
  change: [value: string]
}>()

// Playback state
const playing = ref(false)
const loop = ref(true)
const speedMs = ref(1000)
let timerId: ReturnType<typeof setInterval> | null = null

const speedOptions = [
  { label: '0.25s', value: 250 },
  { label: '0.33s', value: 330 },
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
  const idx = props.values.indexOf(props.currentValue)
  const currentIdx = idx >= 0 ? idx : 0
  if (currentIdx < props.values.length - 1) {
    emit('change', props.values[currentIdx + 1])
  } else if (loop.value) {
    emit('change', props.values[0])
  } else {
    stopPlayback()
  }
}

function onSpeedUpdate(value: number | null) {
  if (value !== null) {
    speedMs.value = value
  }
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
  <div
    class="animation-controls"
    role="group"
    :aria-label="`Animation controls for ${dimensionName}`"
    data-testid="animation-controls"
  >
    <label class="animation-controls__label">
      {{ dimensionName }}
    </label>
    <span class="animation-controls__value">{{ currentValue }}</span>
    <NButton
      size="small"
      circle
      :aria-label="playing ? 'Pause playback' : 'Play playback'"
      class="animation-controls__play-btn"
      :class="{ 'animation-controls__play-btn--playing': playing }"
      data-testid="play-pause-button"
      @click="togglePlayback"
    >
      <svg v-if="!playing" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="play-icon">
        <polygon points="5,3 19,12 5,21" fill="currentColor" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="5" y="3" width="4" height="18" fill="currentColor" />
        <rect x="15" y="3" width="4" height="18" fill="currentColor" />
      </svg>
    </NButton>
    <template v-if="playing">
      <NCheckbox
        :checked="loop"
        aria-label="Loop playback"
        @update:checked="loop = $event"
      >
        Loop
      </NCheckbox>
      <NSelect
        :value="speedMs"
        :options="speedOptions"
        size="small"
        style="min-width: 80px"
        aria-label="Playback speed"
        @update:value="onSpeedUpdate"
      />
    </template>
  </div>
</template>

<style scoped>
.animation-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.animation-controls__label {
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
}

.animation-controls__value {
  font-size: 0.875rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.animation-controls__play-btn {
  flex-shrink: 0;
  color: var(--play-icon-color);
}

.animation-controls__play-btn--playing {
  color: var(--text-secondary);
}

.play-icon {
  transform: translateX(1px);
}
</style>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { NSlider, NButton, NCheckbox, NSelect } from 'naive-ui'
import {
  generateSliderId,
  registerSlider,
  unregisterSlider,
  claimSliderFocus,
  isSliderActive,
} from '../composables/useSliderKeyboardFocus'

const props = withDefaults(defineProps<{
  /** Ordered values to cycle through. */
  values: string[]
  /** Currently selected value for the master slider. */
  currentValue: string
  /** Dimension name for labelling. */
  dimensionName: string
  /** When true, renders the slider vertically (tall, drag up/down). Used for Y axis. */
  vertical?: boolean
}>(), {
  vertical: false,
})

// change: Emitted when the slider value changes (arrow keys, slider drag, or playback tick).
// Payload: the new string value from the values array.
const emit = defineEmits<{
  change: [value: string]
}>()

/** Unique ID for this slider instance within the keyboard focus singleton. */
const sliderId = generateSliderId()

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
    event.stopPropagation()
    const prevIdx = idx > 0 ? idx - 1 : props.values.length - 1
    emit('change', props.values[prevIdx])
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const nextIdx = idx < props.values.length - 1 ? idx + 1 : 0
    emit('change', props.values[nextIdx])
  }
}

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
  const idx = currentIndex.value
  if (idx < props.values.length - 1) {
    emit('change', props.values[idx + 1])
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

/**
 * Document-level keydown handler so plain Arrow keys navigate the slider even
 * when focus is elsewhere (e.g. on the page body or after clicking the NSlider
 * thumb). Skips when a text-input element or another slider (e.g. ZoomControl)
 * has focus to avoid interfering with typing or other slider controls.
 * Also skips when this instance is not the active keyboard owner
 * (another MasterSlider has focus).
 */
function onDocumentKeydown(event: KeyboardEvent) {
  // Only the active slider instance handles document-level keyboard events
  if (!isSliderActive(sliderId)) return

  const activeEl = document.activeElement as HTMLElement | null
  const tag = (activeEl?.tagName ?? '').toLowerCase()
  const role = (activeEl?.getAttribute('role') ?? '').toLowerCase()
  const isInputFocused = tag === 'input' || tag === 'textarea' || tag === 'select'
    || (activeEl?.isContentEditable ?? false)
  // Skip if a non-MasterSlider slider element (e.g. ZoomControl's NSlider) has focus
  const isOtherSliderFocused = role === 'slider' && !activeEl?.closest('.master-slider')
  if (isInputFocused || isOtherSliderFocused) return
  onKeydown(event)
}

/**
 * Claim keyboard focus for this slider instance (e.g. on click or focus).
 */
function onSliderFocus() {
  claimSliderFocus(sliderId)
}

/** Ref for the NSlider wrapper element, used to imperatively set aria-label on the
 *  role="slider" thumb. Naive UI's NSlider does not forward aria-label to its internal
 *  thumb element, so we apply it in onMounted (same pattern as ZoomControl). */
const sliderWrapperRef = ref<HTMLElement | null>(null)

onMounted(() => {
  registerSlider(sliderId)
  document.addEventListener('keydown', onDocumentKeydown)
  // Imperatively set aria-label on the NSlider thumb (role="slider") so axe-core
  // and assistive technologies can identify the slider control.
  if (sliderWrapperRef.value) {
    const thumb = sliderWrapperRef.value.querySelector('[role="slider"]') as HTMLElement | null
    if (thumb) {
      thumb.setAttribute('aria-label', `Master ${props.dimensionName}`)
    }
  }
})

onBeforeUnmount(() => {
  clearTimer()
  document.removeEventListener('keydown', onDocumentKeydown)
  unregisterSlider(sliderId)
})
</script>

<template>
  <div class="master-slider" :class="{ 'master-slider--vertical': vertical }" role="group" :aria-label="`Master ${dimensionName} slider`" tabindex="0" @keydown="onKeydown" @focus="onSliderFocus" @click="onSliderFocus">
    <div class="master-slider__main" :class="{ 'master-slider__main--vertical': vertical }">
      <label class="master-slider__label">
        {{ dimensionName }}
      </label>
      <div ref="sliderWrapperRef" class="master-slider__slider-wrapper" :class="{ 'master-slider__slider-wrapper--vertical': vertical }">
        <NSlider
          :value="currentIndex"
          :min="0"
          :max="Math.max(0, values.length - 1)"
          :step="1"
          :tooltip="false"
          :keyboard="false"
          :vertical="vertical"
          :reverse="vertical"
          class="master-slider__slider"
          @update:value="onUpdate"
        />
      </div>
      <span class="master-slider__value">{{ currentValue }}</span>
      <NButton
        size="small"
        circle
        :aria-label="playing ? 'Pause playback' : 'Play playback'"
        class="master-slider__play-btn"
        :class="{ 'master-slider__play-btn--playing': playing }"
        data-testid="play-pause-button"
        @click="togglePlayback"
      >
        <!-- AC: Play icon (green triangle) when not playing; Pause icon when playing -->
        <svg v-if="!playing" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="play-icon">
          <polygon points="5,3 19,12 5,21" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="5" y="3" width="4" height="18" fill="currentColor" />
          <rect x="15" y="3" width="4" height="18" fill="currentColor" />
        </svg>
      </NButton>
    </div>
    <div v-if="playing" class="master-slider__loop-controls">
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
    </div>
  </div>
</template>

<style scoped>
.master-slider {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 0.5rem;
  width: 100%;
}

.master-slider__main {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}

.master-slider__label {
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
}

.master-slider__slider-wrapper {
  flex: 1;
  min-width: 0;
}

.master-slider__slider {
  width: 100%;
}

.master-slider__value {
  font-size: 0.875rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.master-slider__play-btn {
  flex-shrink: 0;
  color: var(--play-icon-color);
}

.master-slider__play-btn--playing {
  color: var(--text-secondary);
}

.play-icon {
  transform: translateX(1px);
}

.master-slider__loop-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Vertical mode: slider rendered tall with flex-direction column */
.master-slider--vertical {
  flex-direction: column;
  height: 100%;
  width: auto;
  border-bottom: none;
  margin-bottom: 0;
  padding: 0;
}

.master-slider__main--vertical {
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: 0.5rem;
}

.master-slider__slider-wrapper--vertical {
  flex: 1;
  min-height: 0;
  width: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 767px) {
  .master-slider__main {
    flex-wrap: wrap;
  }

  .master-slider__slider {
    order: 2;
    flex-basis: 100%;
  }

  .master-slider__loop-controls {
    flex-wrap: wrap;
  }
}
</style>

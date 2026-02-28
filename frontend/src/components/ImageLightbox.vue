<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { NButton } from 'naive-ui'
import { apiClient } from '../api/client'
import SliderBar from './SliderBar.vue'

const props = defineProps<{
  imageUrl: string
  /** Cell key (xVal|yVal) identifying which grid cell opened the lightbox. Null when no slider. */
  cellKey: string | null
  /** Ordered slider dimension values. Empty array when no slider dimension assigned. */
  sliderValues: string[]
  /** Current slider value for this cell. Empty string when no slider dimension. */
  currentSliderValue: string
  /** Map from slider value → image URL for this cell. Empty object when no slider. */
  imagesBySliderValue: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  'slider-change': [cellKey: string, value: string]
}>()

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartTranslateX = ref(0)
const dragStartTranslateY = ref(0)

const metadataLoading = ref(false)
const metadataError = ref<string | null>(null)
const metadata = ref<Record<string, string> | null>(null)
const metadataOpen = ref(false)

const MIN_SCALE = 0.1
const MAX_SCALE = 20
const ZOOM_FACTOR = 1.1
const ZOOM_STEP = 0.25

/** Extract the relative image filepath from the full image URL. */
function extractFilepath(imageUrl: string): string | null {
  const prefix = '/api/images/'
  const idx = imageUrl.indexOf(prefix)
  if (idx < 0) return null
  return imageUrl.substring(idx + prefix.length)
}

async function fetchMetadata() {
  const filepath = extractFilepath(props.imageUrl)
  if (!filepath) return

  metadataLoading.value = true
  metadataError.value = null
  metadata.value = null

  try {
    const result = await apiClient.getImageMetadata(filepath)
    metadata.value = result.metadata
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load metadata'
    metadataError.value = message
  } finally {
    metadataLoading.value = false
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const direction = e.deltaY < 0 ? 1 : -1
  const factor = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))

  // Zoom toward the mouse position
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2
  const offsetX = mouseX - centerX
  const offsetY = mouseY - centerY

  const scaleRatio = newScale / scale.value
  translateX.value = offsetX - scaleRatio * (offsetX - translateX.value)
  translateY.value = offsetY - scaleRatio * (offsetY - translateY.value)

  scale.value = newScale
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragStartTranslateX.value = translateX.value
  dragStartTranslateY.value = translateY.value
  e.preventDefault()
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = dragStartTranslateX.value + (e.clientX - dragStartX.value)
  translateY.value = dragStartTranslateY.value + (e.clientY - dragStartY.value)
}

function onMouseUp() {
  isDragging.value = false
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

function onContentClick(e: MouseEvent) {
  // Close when clicking the content area background (not the image itself)
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }

  // Arrow keys navigate the lightbox slider when it is visible
  if (!hasSlider.value || !props.cellKey) return
  const idx = props.sliderValues.indexOf(props.currentSliderValue)
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopImmediatePropagation()  // prevent MasterSlider document handler from also firing
    if (idx > 0) {
      emit('slider-change', props.cellKey, props.sliderValues[idx - 1])
    }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopImmediatePropagation()  // prevent MasterSlider document handler from also firing
    if (idx < props.sliderValues.length - 1) {
      emit('slider-change', props.cellKey, props.sliderValues[idx + 1])
    }
  }
}

function zoomIn() {
  const newScale = Math.min(MAX_SCALE, scale.value + ZOOM_STEP)
  scale.value = newScale
}

function zoomOut() {
  const newScale = Math.max(MIN_SCALE, scale.value - ZOOM_STEP)
  scale.value = newScale
}

function resetZoom() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function toggleMetadata() {
  metadataOpen.value = !metadataOpen.value
}

function formatJSON(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

/** Whether the slider bar should be shown. */
const hasSlider = computed(() => props.sliderValues.length > 1 && props.cellKey !== null)

/** Handle slider value change in the lightbox. */
function onLightboxSliderChange(value: string) {
  if (!props.cellKey) return
  emit('slider-change', props.cellKey, value)
}

/** Preload adjacent slider position images for instant feel. */
function preloadAdjacentSliderImages(currentValue: string) {
  if (!hasSlider.value) return
  const idx = props.sliderValues.indexOf(currentValue)
  const toPreload: number[] = []
  if (idx > 0) toPreload.push(idx - 1)
  if (idx < props.sliderValues.length - 1) toPreload.push(idx + 1)
  for (const i of toPreload) {
    const val = props.sliderValues[i]
    const url = props.imagesBySliderValue[val]
    if (url) {
      const img = new Image()
      img.src = url
    }
  }
}

// Reset transform and fetch metadata when the image changes
watch(() => props.imageUrl, () => {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  metadata.value = null
  metadataError.value = null
  metadataOpen.value = false
  fetchMetadata()
})

// Preload adjacent images when slider value changes
watch(() => props.currentSliderValue, (newVal) => {
  preloadAdjacentSliderImages(newVal)
})

onMounted(() => {
  // Use capture phase so this handler fires before non-capture listeners (e.g. MasterSlider),
  // allowing stopImmediatePropagation to prevent them from also handling the same arrow key.
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  fetchMetadata()
  preloadAdjacentSliderImages(props.currentSliderValue)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    class="lightbox-backdrop"
    role="dialog"
    aria-label="Image lightbox"
    @click="onBackdropClick"
  >
    <NButton
      class="lightbox-close"
      quaternary
      circle
      size="large"
      aria-label="Close lightbox"
      @click="emit('close')"
    >
      &times;
    </NButton>
    <div class="lightbox-zoom-controls" aria-label="Zoom controls">
      <NButton
        class="lightbox-zoom-btn"
        quaternary
        size="small"
        aria-label="Zoom in"
        @click="zoomIn"
      >+</NButton>
      <NButton
        class="lightbox-zoom-btn"
        quaternary
        size="small"
        aria-label="Reset zoom"
        @click="resetZoom"
      >Reset</NButton>
      <NButton
        class="lightbox-zoom-btn"
        quaternary
        size="small"
        aria-label="Zoom out"
        @click="zoomOut"
      >-</NButton>
    </div>
    <div
      class="lightbox-content"
      @wheel="onWheel"
      @mousedown="onMouseDown"
      @click="onContentClick"
    >
      <img
        :src="imageUrl"
        alt="Full-size image"
        class="lightbox-image"
        :style="{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }"
        draggable="false"
      />
    </div>
    <div v-if="hasSlider" class="lightbox-slider-panel" @click.stop>
      <SliderBar
        :values="sliderValues"
        :current-value="currentSliderValue"
        label="Slider"
        @change="onLightboxSliderChange"
      />
    </div>
    <div class="metadata-panel" @click.stop>
      <NButton
        class="metadata-toggle"
        size="small"
        aria-label="Toggle metadata"
        @click="toggleMetadata"
      >
        {{ metadataOpen ? 'Hide Metadata' : 'Show Metadata' }}
      </NButton>
      <div v-if="metadataOpen" class="metadata-content">
        <div v-if="metadataLoading" class="metadata-loading">Loading metadata...</div>
        <div v-else-if="metadataError" class="metadata-error">{{ metadataError }}</div>
        <div v-else-if="metadata && Object.keys(metadata).length === 0" class="metadata-empty">
          No metadata available
        </div>
        <div v-else-if="metadata" class="metadata-entries">
          <div v-for="key in Object.keys(metadata).sort()" :key="key" class="metadata-entry">
            <div class="metadata-key">{{ key }}</div>
            <pre class="metadata-value">{{ formatJSON(metadata[key]) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lightbox-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.lightbox-close {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 1002;
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.8);
}

.lightbox-zoom-controls {
  position: fixed;
  top: 12px;
  left: 60px;
  z-index: 1002;
  display: flex;
  gap: 4px;
  align-items: center;
}

.lightbox-zoom-btn {
  color: rgba(255, 255, 255, 0.8);
  font-size: 1rem;
}

.lightbox-content {
  overflow: hidden;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 90vh;
  transform-origin: center center;
  user-select: none;
}

.lightbox-slider-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1001;
  background: rgba(20, 20, 20, 0.85);
  padding: 0.5rem 1rem;
}

.metadata-panel {
  position: fixed;
  bottom: 0;
  right: 0;
  max-width: 50vw;
  max-height: 60vh;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.metadata-toggle {
  border-radius: 0.25rem 0.25rem 0 0;
}

.metadata-content {
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.25rem 0 0 0;
  padding: 0.75rem;
  overflow-y: auto;
  max-height: 50vh;
  width: 50vw;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #e0e0e0;
  font-size: 0.8125rem;
}

.metadata-loading,
.metadata-error,
.metadata-empty {
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #999;
  font-style: italic;
}

.metadata-error {
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #f44336;
}

.metadata-entry {
  margin-bottom: 0.75rem;
}

.metadata-entry:last-child {
  margin-bottom: 0;
}

.metadata-key {
  font-weight: 600;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #90caf9;
  margin-bottom: 0.25rem;
}

.metadata-value {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem;
  border-radius: 0.25rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  max-height: 30vh;
  overflow-y: auto;
}

@media (max-width: 767px) {
  .metadata-panel {
    max-width: 100vw;
    left: 0;
    right: 0;
    align-items: stretch;
  }

  .metadata-content {
    width: 100vw;
    max-width: 100vw;
    border-radius: 0;
    box-sizing: border-box;
  }

  .metadata-toggle {
    border-radius: 0.25rem 0.25rem 0 0;
    align-self: flex-end;
  }
}
</style>

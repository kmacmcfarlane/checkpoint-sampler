<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { NButton } from 'naive-ui'
import { apiClient } from '../api/client'
import SliderBar from './SliderBar.vue'
import MasterSlider from './MasterSlider.vue'
import DebugOverlay from './DebugOverlay.vue'
import type { DebugCellInfo, GridNavItem } from './types'

const props = withDefaults(defineProps<{
  imageUrl: string
  /** Cell key (xVal|yVal) identifying which grid cell opened the lightbox. Null when no slider. */
  cellKey: string | null
  /** Ordered slider dimension values. Empty array when no slider dimension assigned. */
  sliderValues: string[]
  /** Current slider value for this cell. Empty string when no slider dimension. */
  currentSliderValue: string
  /** Map from slider value → image URL for this cell. Empty object when no slider. */
  imagesBySliderValue: Record<string, string>
  /** The actual dimension name for the slider (e.g. 'cfg', 'checkpoint'). Empty string when no slider. */
  sliderDimensionName: string
  /** Ordered list of all visible grid images, for Shift+Arrow navigation. */
  gridImages: GridNavItem[]
  /** Index of the currently displayed image in gridImages. */
  gridIndex: number
  /**
   * Number of X-axis columns in the grid. Used for Shift+Up/Down Y-axis navigation.
   * 0 when there is no X dimension (Y-only or flat mode), which disables Y navigation.
   */
  gridColumnCount: number
  /** When true, renders a debug overlay showing the image's generation parameters. */
  debugMode?: boolean
  /** Debug info for the current image. Shown when debugMode is true. */
  debugInfo?: DebugCellInfo
  /** Ordered X dimension values. Empty array when no X dimension assigned. */
  xSliderValues?: string[]
  /** Current X slider value. Empty string when no X dimension. */
  currentXSliderValue?: string
  /** X dimension name. Empty string when no X dimension. */
  xDimensionName?: string
  /** Ordered Y dimension values. Empty array when no Y dimension assigned. */
  ySliderValues?: string[]
  /** Current Y slider value. Empty string when no Y dimension. */
  currentYSliderValue?: string
  /** Y dimension name. Empty string when no Y dimension. */
  yDimensionName?: string
}>(), {
  xSliderValues: () => [],
  currentXSliderValue: '',
  xDimensionName: '',
  ySliderValues: () => [],
  currentYSliderValue: '',
  yDimensionName: '',
})

// close: Emitted when the lightbox is dismissed (Escape key, backdrop click, or close button). No payload.
// slider-change: Emitted when the in-lightbox slider changes value. Payload: cell key and new slider value.
// navigate: Emitted when the user navigates to a different grid image via Shift+Arrow (X or Y axis). Payload: new grid index.
// x-slider-change: Emitted when the lightbox X slider changes value. Payload: new X value.
// y-slider-change: Emitted when the lightbox Y slider changes value. Payload: new Y value.
const emit = defineEmits<{
  close: []
  'slider-change': [cellKey: string, value: string]
  navigate: [index: number]
  'x-slider-change': [value: string]
  'y-slider-change': [value: string]
}>()

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartTranslateX = ref(0)
const dragStartTranslateY = ref(0)

/**
 * Tracks whether the most recent mousedown on the backdrop element targeted
 * the backdrop itself (not a bubbled event from a child). Used to guard
 * onBackdropClick so it only closes the lightbox when the full click gesture
 * (mousedown + mouseup) originated on the backdrop background — not when the
 * user drags a slider and releases the mouse there.
 */
const backdropMouseDownOnSelf = ref(false)

/**
 * Tracks whether the most recent mousedown on the content element targeted
 * the content element itself (not a bubbled event from the image child). Used
 * to guard onContentClick for the same reason.
 */
const contentMouseDownOnSelf = ref(false)

/**
 * Local slider index that is updated immediately on key press, without waiting
 * for the parent to re-render and update currentSliderValue. This ensures
 * rapid/auto-repeat key presses advance correctly through non-uniform value
 * intervals — each press advances from the previously emitted position rather
 * than re-reading a stale prop.
 */
const localSliderIndex = ref(-1)

const metadataLoading = ref(false)
const metadataError = ref<string | null>(null)
const stringMetadata = ref<Record<string, string> | null>(null)
const numericMetadata = ref<Record<string, number> | null>(null)
const metadataOpen = ref(false)
const shortcutsOpen = ref(false)

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
  stringMetadata.value = null
  numericMetadata.value = null

  try {
    const result = await apiClient.getImageMetadata(filepath)
    stringMetadata.value = result.string_metadata
    numericMetadata.value = result.numeric_metadata
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

function onBackdropMouseDown(e: MouseEvent) {
  // Only record a self-targeted mousedown on the backdrop itself. Bubbled events
  // from children do not count — those must not reset the content flag either,
  // so each flag is independent and only set/cleared by its own element.
  backdropMouseDownOnSelf.value = e.target === e.currentTarget
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget && backdropMouseDownOnSelf.value) {
    emit('close')
  }
  backdropMouseDownOnSelf.value = false
}

function onContentMouseDown(e: MouseEvent) {
  // Track whether the mousedown targeted the content background directly.
  contentMouseDownOnSelf.value = e.target === e.currentTarget
  // Delegate to the pan handler as well.
  onMouseDown(e)
}

function onContentClick(e: MouseEvent) {
  // Close when clicking the content area background (not the image itself),
  // and only if the mousedown also originated on the content background.
  if (e.target === e.currentTarget && contentMouseDownOnSelf.value) {
    emit('close')
  }
  contentMouseDownOnSelf.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }

  // '?' toggles the keyboard shortcuts help panel
  if (e.key === '?') {
    toggleShortcuts()
    return
  }

  // Shift+ArrowLeft / Shift+ArrowRight navigate between grid images along the X axis (wrapping)
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    const total = props.gridImages.length
    if (total === 0) return
    if (e.key === 'ArrowLeft') {
      const newIndex = (props.gridIndex - 1 + total) % total
      emit('navigate', newIndex)
    } else {
      const newIndex = (props.gridIndex + 1) % total
      emit('navigate', newIndex)
    }
    return
  }

  // Shift+ArrowUp / Shift+ArrowDown navigate between grid images along the Y axis (wrapping)
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) {
    e.preventDefault()
    e.stopImmediatePropagation()
    const total = props.gridImages.length
    const cols = props.gridColumnCount
    if (total === 0 || cols <= 0) return
    if (e.key === 'ArrowUp') {
      const newIndex = (props.gridIndex - cols + total) % total
      emit('navigate', newIndex)
    } else {
      const newIndex = (props.gridIndex + cols) % total
      emit('navigate', newIndex)
    }
    return
  }

  // Plain ArrowUp / ArrowDown navigate the Y slider (when present)
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && hasYSlider.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    const yIdx = props.ySliderValues.indexOf(props.currentYSliderValue)
    if (e.key === 'ArrowUp' && yIdx < props.ySliderValues.length - 1) {
      emit('y-slider-change', props.ySliderValues[yIdx + 1])
    } else if (e.key === 'ArrowDown' && yIdx > 0) {
      emit('y-slider-change', props.ySliderValues[yIdx - 1])
    }
    return
  }

  // Plain ArrowLeft / ArrowRight navigate the X slider first, then per-cell slider
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // X slider takes priority when present
    if (hasXSlider.value) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const xIdx = props.xSliderValues.indexOf(props.currentXSliderValue)
      if (e.key === 'ArrowLeft' && xIdx > 0) {
        emit('x-slider-change', props.xSliderValues[xIdx - 1])
      } else if (e.key === 'ArrowRight' && xIdx < props.xSliderValues.length - 1) {
        emit('x-slider-change', props.xSliderValues[xIdx + 1])
      }
      return
    }

    // Fall back to per-cell slider if no X slider
    if (hasSlider.value && props.cellKey) {
      e.preventDefault()
      e.stopImmediatePropagation()
      // Use localSliderIndex (updated immediately on each key press) rather than
      // re-deriving the index from props.currentSliderValue every time. The prop
      // update from the parent is asynchronous (Vue batches re-renders), so under
      // rapid/auto-repeat key presses props.currentSliderValue may still reflect
      // the old value.
      const idx = localSliderIndex.value
      if (e.key === 'ArrowLeft' && idx > 0) {
        const newIdx = idx - 1
        localSliderIndex.value = newIdx
        emit('slider-change', props.cellKey, props.sliderValues[newIdx])
      } else if (e.key === 'ArrowRight' && idx < props.sliderValues.length - 1) {
        const newIdx = idx + 1
        localSliderIndex.value = newIdx
        emit('slider-change', props.cellKey, props.sliderValues[newIdx])
      }
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

function toggleShortcuts() {
  shortcutsOpen.value = !shortcutsOpen.value
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

/** Whether the X axis slider should be shown in the lightbox. */
const hasXSlider = computed(() => props.xSliderValues.length > 1)

/** Whether the Y axis slider should be shown in the lightbox. */
const hasYSlider = computed(() => props.ySliderValues.length > 1)

/** Whether the grid position indicator should be shown (only when there are multiple images). */
const showGridIndicator = computed(() => props.gridImages.length > 1)

/** Human-readable position label, e.g. "3 / 12". */
const gridPositionLabel = computed(() => `${props.gridIndex + 1} / ${props.gridImages.length}`)

/** Handle slider value change in the lightbox. */
function onLightboxSliderChange(value: string) {
  if (!props.cellKey) return
  emit('slider-change', props.cellKey, value)
}

/** Handle X slider change in the lightbox — syncs to main view. */
function onLightboxXSliderChange(value: string) {
  emit('x-slider-change', value)
}

/** Handle Y slider change in the lightbox — syncs to main view. */
function onLightboxYSliderChange(value: string) {
  emit('y-slider-change', value)
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

// Keep localSliderIndex in sync with the slider prop.
// This runs immediately (immediate: true) to initialise on mount, and also
// fires whenever currentSliderValue or sliderValues change (e.g. the parent
// updates after receiving a slider-change event, or the user navigates to a
// different grid image with Shift+Arrow). The local index is the ground truth
// used by onKeyDown so that rapid key presses advance sequentially even when
// the parent re-render hasn't completed yet.
watch(
  [() => props.currentSliderValue, () => props.sliderValues],
  ([newVal]) => {
    const idx = props.sliderValues.indexOf(newVal)
    localSliderIndex.value = idx >= 0 ? idx : 0
  },
  { immediate: true },
)

// Reset transform and fetch metadata when the image changes
watch(() => props.imageUrl, () => {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  stringMetadata.value = null
  numericMetadata.value = null
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
    :class="{ 'lightbox--has-x-slider': hasXSlider || hasSlider, 'lightbox--has-y-slider': hasYSlider }"
    role="dialog"
    aria-label="Image lightbox"
    @mousedown="onBackdropMouseDown"
    @click="onBackdropClick"
  >
    <!-- Row 1: Header bar spanning all columns -->
    <div class="lightbox-header" @click.stop>
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
        v-if="showGridIndicator"
        class="lightbox-grid-indicator"
        data-testid="lightbox-grid-indicator"
        aria-label="Grid position"
      >{{ gridPositionLabel }}</div>
      <div class="lightbox-header-spacer"></div>
      <NButton
        class="lightbox-metadata-btn"
        quaternary
        size="small"
        aria-label="Toggle metadata"
        @click="toggleMetadata"
      >
        {{ metadataOpen ? 'Hide Metadata' : 'Metadata' }}
      </NButton>
      <div class="lightbox-shortcuts-area">
        <NButton
          class="lightbox-shortcuts-btn"
          secondary
          circle
          size="medium"
          aria-label="Toggle keyboard shortcuts"
          data-testid="lightbox-shortcuts-btn"
          @click="toggleShortcuts"
        >?</NButton>
      </div>
    </div>

    <!-- Shortcuts panel (overlays content, not part of grid flow) -->
    <div
      v-if="shortcutsOpen"
      class="lightbox-shortcuts-panel"
      data-testid="lightbox-shortcuts-panel"
      @click.stop
    >
      <div class="shortcuts-title">Keyboard Shortcuts</div>
      <ul class="shortcuts-list">
        <li><kbd>Esc</kbd> Close lightbox</li>
        <li><kbd>?</kbd> Toggle this help panel</li>
        <li><kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd> Navigate grid (X axis)</li>
        <li><kbd>Shift</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> Navigate grid (Y axis)</li>
        <li><kbd>←</kbd> <kbd>→</kbd> Slider (when active)</li>
      </ul>
    </div>

    <!-- Metadata panel (overlays content) -->
    <div v-if="metadataOpen" class="metadata-panel" @click.stop>
      <div class="metadata-content">
        <div v-if="metadataLoading" class="metadata-loading">Loading metadata...</div>
        <div v-else-if="metadataError" class="metadata-error">{{ metadataError }}</div>
        <div v-else-if="stringMetadata && numericMetadata && Object.keys(stringMetadata).length === 0 && Object.keys(numericMetadata).length === 0" class="metadata-empty">
          No metadata available
        </div>
        <div v-else-if="stringMetadata && numericMetadata" class="metadata-entries">
          <div v-for="key in [...Object.keys(stringMetadata), ...Object.keys(numericMetadata)].sort()" :key="key" class="metadata-entry">
            <div class="metadata-key">{{ key }}</div>
            <pre v-if="key in numericMetadata" class="metadata-value">{{ numericMetadata[key] }}</pre>
            <pre v-else class="metadata-value">{{ formatJSON(stringMetadata[key]) }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 2: Main content area (transparent, image shows through) -->
    <div
      class="lightbox-content"
      @wheel="onWheel"
      @mousedown="onContentMouseDown"
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

    <!-- Debug overlay (floats over content) -->
    <DebugOverlay
      v-if="debugMode && debugInfo"
      :info="debugInfo"
      class="lightbox-debug-overlay"
      data-testid="lightbox-debug-overlay"
    />

    <!-- Row 2 right column: Y slider -->
    <div
      v-if="hasYSlider"
      class="lightbox-y-slider-bar"
      data-testid="lightbox-y-slider-bar"
      @click.stop
    >
      <MasterSlider
        :values="ySliderValues"
        :current-value="currentYSliderValue"
        :dimension-name="yDimensionName"
        :vertical="true"
        @change="onLightboxYSliderChange"
      />
    </div>

    <!-- Row 3: X slider or per-cell slider -->
    <div
      v-if="hasXSlider"
      class="lightbox-x-slider-bar"
      data-testid="lightbox-x-slider-bar"
      @click.stop
    >
      <MasterSlider
        :values="xSliderValues"
        :current-value="currentXSliderValue"
        :dimension-name="xDimensionName"
        @change="onLightboxXSliderChange"
      />
    </div>
    <div v-else-if="hasSlider" class="lightbox-slider-panel" @click.stop>
      <SliderBar
        :values="sliderValues"
        :current-value="currentSliderValue"
        :label="sliderDimensionName || 'Slider'"
        @change="onLightboxSliderChange"
      />
    </div>

    <!-- Bottom-right spacer when both X/slider and Y are present -->
    <div
      v-if="(hasXSlider || hasSlider) && hasYSlider"
      class="lightbox-corner-spacer"
    ></div>
  </div>
</template>

<style scoped>
/* ---- Grid-based lightbox layout ---- */
.lightbox-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  overflow: hidden;
}

/* When Y slider visible, add right column */
.lightbox--has-y-slider {
  grid-template-columns: 1fr 4rem;
}

/* When X/per-cell slider visible, add bottom row */
.lightbox--has-x-slider {
  grid-template-rows: auto 1fr auto;
}

/* ---- Row 1: Header bar ---- */
.lightbox-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  z-index: 1002;
}

.lightbox-close {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.lightbox-zoom-controls {
  display: flex;
  gap: 4px;
  align-items: center;
}

.lightbox-zoom-btn {
  color: rgba(255, 255, 255, 0.8);
  font-size: 1rem;
}

.lightbox-grid-indicator {
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  background: rgba(0, 0, 0, 0.65);
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  border: 1px solid rgba(255, 255, 255, 0.55);
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 0.3rem 0.875rem;
  border-radius: 1rem;
  white-space: nowrap;
  user-select: none;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  letter-spacing: 0.02em;
}

.lightbox-header-spacer {
  flex: 1;
}

.lightbox-metadata-btn {
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.lightbox-shortcuts-area {
  flex-shrink: 0;
}

.lightbox-shortcuts-btn {
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: rgba(255, 255, 255, 0.9);
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  background-color: rgba(255, 255, 255, 0.15) !important;
  font-size: 1rem;
  font-weight: 700;
}

/* Shortcuts panel floats over content */
.lightbox-shortcuts-panel {
  position: fixed;
  top: 3.5rem;
  right: 0.75rem;
  z-index: 1010;
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.25rem;
  padding: 0.75rem 1rem;
  min-width: 260px;
}

.shortcuts-title {
  font-weight: 600;
  font-size: 0.8125rem;
  margin-bottom: 0.5rem;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #90caf9;
}

.shortcuts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.8125rem;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #e0e0e0;
}

.shortcuts-list li {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

kbd {
  display: inline-block;
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  font-family: 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value -- Intentional: lightbox overlay always has dark background regardless of theme */
  color: #e0e0e0;
}

/* ---- Row 2: Content area ---- */
.lightbox-content {
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.lightbox-image {
  max-width: 90%;
  max-height: 90%;
  transform-origin: center center;
  user-select: none;
}

.lightbox-debug-overlay {
  position: absolute;
  bottom: 4rem;
  left: 0;
  z-index: 1002;
  max-width: 300px;
  pointer-events: none;
}

/* ---- Row 2 right column: Y slider ---- */
.lightbox-y-slider-bar {
  background: rgba(20, 20, 20, 0.85);
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  padding: 1rem 0.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  user-select: none;
  min-height: 0;
  overflow: hidden;
}

/* ---- Row 3: X slider / per-cell slider ---- */
.lightbox-x-slider-bar {
  background: rgba(20, 20, 20, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  padding: 0.25rem 1rem;
  user-select: none;
}

.lightbox-slider-panel {
  background: rgba(20, 20, 20, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  padding: 0.5rem 1rem;
  user-select: none;
}

/* Bottom-right corner spacer */
.lightbox-corner-spacer {
  background: rgba(20, 20, 20, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-left: 1px solid rgba(255, 255, 255, 0.15);
}

/* ---- Metadata panel (floats over content) ---- */
.metadata-panel {
  position: fixed;
  top: 3.5rem;
  right: 0.75rem;
  max-width: 50vw;
  max-height: 60vh;
  z-index: 1010;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.metadata-content {
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.25rem;
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

  .lightbox-x-slider-bar {
    padding: 0.25rem 0.5rem;
  }

  .lightbox-y-slider-bar {
    padding: 0.5rem 0.25rem;
  }
}
</style>

<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import type { ScanDimension, ScanImage } from '../api/types'
import type { GridNavItem, ImageClickContext } from './types'
import ImageCell from './ImageCell.vue'
import SliderBar from './SliderBar.vue'

const props = withDefaults(defineProps<{
  xDimension: ScanDimension | null
  yDimension: ScanDimension | null
  images: ScanImage[]
  comboSelections: Record<string, Set<string>>
  sliderDimension: ScanDimension | null
  sliderValues: Record<string, string>
  /** Default slider value when no per-cell override exists (set by master slider). */
  defaultSliderValue: string
  /** Cell size in pixels (both width and height). */
  cellSize: number
  /** Whether to maintain aspect ratio during corner resize (default: true). */
  maintainAspectRatio?: boolean
}>(), {
  maintainAspectRatio: true,
})

// update:sliderValue: Emitted when a cell's slider changes. Payload: the cell key and new slider value.
// image:click: Emitted when a cell image is clicked. Payload: full click context including grid navigation info.
// header:click: Emitted when a row or column header is clicked. Payload: dimension name and value.
// update:cellSize: Emitted when the user drags the resize handle. Payload: new cell size in pixels.
const emit = defineEmits<{
  'update:sliderValue': [cellKey: string, value: string]
  'image:click': [context: ImageClickContext]
  'header:click': [dimensionName: string, value: string]
  'update:cellSize': [size: number]
}>()

// --- Cell dimensions controlled by zoom ---
const cellWidth = computed(() => props.cellSize)
const cellHeight = computed(() => props.cellSize)

function onHeaderClick(dimensionName: string, value: string) {
  emit('header:click', dimensionName, value)
}

/** X axis values to render as columns (filtered by combo selections). */
const xValues = computed(() => {
  const dim = props.xDimension
  if (!dim) return []
  const selections = props.comboSelections[dim.name]
  if (!selections || selections.size === 0) return dim.values
  return dim.values.filter((v) => selections.has(v))
})

/** Y axis values to render as rows (filtered by combo selections). */
const yValues = computed(() => {
  const dim = props.yDimension
  if (!dim) return []
  const selections = props.comboSelections[dim.name]
  if (!selections || selections.size === 0) return dim.values
  return dim.values.filter((v) => selections.has(v))
})

/** Filter images based on combo filter selections. Slider filtering is per-cell in imageIndex. */
const filteredImages = computed<ScanImage[]>(() => {
  return props.images.filter((img) => {
    for (const [dimName, selected] of Object.entries(props.comboSelections)) {
      const imgValue = img.dimensions[dimName]
      if (imgValue !== undefined && !selected.has(imgValue)) {
        return false
      }
    }
    return true
  })
})

/** Build a lookup key from dimension values. */
function imageKey(xVal: string | undefined, yVal: string | undefined): string {
  return `${xVal ?? ''}|${yVal ?? ''}`
}

/** Index filtered images for fast lookup by x/y dimension values. */
const imageIndex = computed<Map<string, ScanImage>>(() => {
  const index = new Map<string, ScanImage>()
  const xDimName = props.xDimension?.name
  const yDimName = props.yDimension?.name

  for (const img of filteredImages.value) {
    const xVal = xDimName ? img.dimensions[xDimName] : undefined
    const yVal = yDimName ? img.dimensions[yDimName] : undefined

    // Check slider dimension
    if (props.sliderDimension) {
      const sliderDimName = props.sliderDimension.name
      const sliderVal = img.dimensions[sliderDimName]
      const key = imageKey(xVal, yVal)
      const expectedSliderVal = props.sliderValues[key] ?? props.defaultSliderValue
      if (sliderVal !== undefined && sliderVal !== expectedSliderVal) {
        continue
      }
    }

    const key = imageKey(xVal, yVal)
    // First match wins (images are already deduplicated by scanner)
    if (!index.has(key)) {
      index.set(key, img)
    }
  }
  return index
})

/** Get the image for a specific x/y combination. */
function getImage(xVal: string | undefined, yVal: string | undefined): ScanImage | null {
  return imageIndex.value.get(imageKey(xVal, yVal)) ?? null
}

/** Get the current slider value for a given cell. */
function getSliderValue(xVal: string | undefined, yVal: string | undefined): string {
  const key = imageKey(xVal, yVal)
  return props.sliderValues[key] ?? props.defaultSliderValue
}

/** Handle slider change for a cell. */
function onSliderChange(xVal: string | undefined, yVal: string | undefined, value: string) {
  const key = imageKey(xVal, yVal)
  emit('update:sliderValue', key, value)
}

/** Build a map from slider value → image URL for a given cell (all slider positions). */
function getImagesBySliderValue(xVal: string | undefined, yVal: string | undefined): Record<string, string> {
  if (!props.sliderDimension) return {}
  const sliderDimName = props.sliderDimension.name
  const xDimName = props.xDimension?.name
  const yDimName = props.yDimension?.name
  const result: Record<string, string> = {}
  for (const img of filteredImages.value) {
    const imgXVal = xDimName ? img.dimensions[xDimName] : undefined
    const imgYVal = yDimName ? img.dimensions[yDimName] : undefined
    if (imgXVal !== xVal || imgYVal !== yVal) continue
    const sliderVal = img.dimensions[sliderDimName]
    if (sliderVal !== undefined && !(sliderVal in result)) {
      result[sliderVal] = `/api/images/${img.relative_path}`
    }
  }
  return result
}

/**
 * Build the ordered list of all visible grid cells that have images,
 * for lightbox grid navigation.
 */
function buildGridNavItems(): GridNavItem[] {
  const items: GridNavItem[] = []
  const sliderVals = props.sliderDimension?.values ?? []

  if (hasNoAxes.value) {
    // Flat mode: one synthetic cell
    for (const img of flatImages.value) {
      const url = `/api/images/${img.relative_path}`
      items.push({
        imageUrl: url,
        cellKey: '|',
        sliderValues: sliderVals,
        currentSliderValue: getSliderValue(undefined, undefined),
        imagesBySliderValue: getImagesBySliderValue(undefined, undefined),
      })
    }
  } else if (props.xDimension && props.yDimension) {
    // X+Y grid: row-major order (y outer, x inner)
    for (const yVal of yValues.value) {
      for (const xVal of xValues.value) {
        const img = getImage(xVal, yVal)
        if (!img) continue
        const url = `/api/images/${img.relative_path}`
        items.push({
          imageUrl: url,
          cellKey: imageKey(xVal, yVal),
          sliderValues: sliderVals,
          currentSliderValue: getSliderValue(xVal, yVal),
          imagesBySliderValue: getImagesBySliderValue(xVal, yVal),
        })
      }
    }
  } else if (props.xDimension) {
    // X-only
    for (const xVal of xValues.value) {
      const img = getImage(xVal, undefined)
      if (!img) continue
      const url = `/api/images/${img.relative_path}`
      items.push({
        imageUrl: url,
        cellKey: imageKey(xVal, undefined),
        sliderValues: sliderVals,
        currentSliderValue: getSliderValue(xVal, undefined),
        imagesBySliderValue: getImagesBySliderValue(xVal, undefined),
      })
    }
  } else if (props.yDimension) {
    // Y-only
    for (const yVal of yValues.value) {
      const img = getImage(undefined, yVal)
      if (!img) continue
      const url = `/api/images/${img.relative_path}`
      items.push({
        imageUrl: url,
        cellKey: imageKey(undefined, yVal),
        sliderValues: sliderVals,
        currentSliderValue: getSliderValue(undefined, yVal),
        imagesBySliderValue: getImagesBySliderValue(undefined, yVal),
      })
    }
  }

  return items
}

/** Emit an image:click event with full cell context. */
function onImageClick(xVal: string | undefined, yVal: string | undefined, imageUrl: string) {
  const key = imageKey(xVal, yVal)
  const sliderVals = props.sliderDimension?.values ?? []
  const currentSliderVal = getSliderValue(xVal, yVal)
  const imagesBySliderValue = getImagesBySliderValue(xVal, yVal)
  const gridImages = buildGridNavItems()
  const gridIndex = gridImages.findIndex((item) => item.cellKey === key && item.imageUrl === imageUrl)
  emit('image:click', {
    imageUrl,
    cellKey: key,
    sliderValues: sliderVals,
    currentSliderValue: currentSliderVal,
    imagesBySliderValue,
    gridImages,
    gridIndex: gridIndex >= 0 ? gridIndex : 0,
  })
}

/** Check whether there are no axis assignments. */
const hasNoAxes = computed(() => !props.xDimension && !props.yDimension)

/** When no axes are assigned, show all filtered images in a flat list. */
const flatImages = computed<ScanImage[]>(() => {
  if (!hasNoAxes.value) return []
  // Apply slider filter to flat images too
  if (props.sliderDimension) {
    const sliderDimName = props.sliderDimension.name
    const expectedVal = props.sliderValues['|'] ?? props.defaultSliderValue
    return filteredImages.value.filter((img) => {
      const val = img.dimensions[sliderDimName]
      return val === undefined || val === expectedVal
    })
  }
  return filteredImages.value
})

// --- CSS Grid placement helpers ---

/** Column offset: data columns start at 2 when row headers present, else 1. */
const colBase = computed(() => (props.yDimension ? 2 : 1))

/** Row offset: data rows start at 2 when column headers present, else 1. */
const rowBase = computed(() => (props.xDimension ? 2 : 1))

/** CSS grid-column for the i-th X value (0-based). */
function colIndex(i: number): number {
  return colBase.value + i
}

/** CSS grid-row for the j-th Y value (0-based). */
function rowIndex(j: number): number {
  return rowBase.value + j
}

/** Computed grid-template-columns. */
const gridTemplateColumns = computed(() => {
  const parts: string[] = []
  if (props.yDimension) parts.push('auto')
  if (props.xDimension) {
    for (let i = 0; i < xValues.value.length; i++) {
      parts.push(`${cellWidth.value}px`)
    }
  } else if (props.yDimension) {
    parts.push(`${cellWidth.value}px`)
  }
  return parts.join(' ')
})

/** Computed grid-template-rows. */
const gridTemplateRows = computed(() => {
  const parts: string[] = []
  if (props.xDimension) parts.push('auto')
  if (props.yDimension) {
    for (let j = 0; j < yValues.value.length; j++) {
      parts.push(`${cellHeight.value}px`)
    }
  } else if (props.xDimension) {
    parts.push(`${cellHeight.value}px`)
  }
  return parts.join(' ')
})

/** Inline style for the CSS Grid container. */
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: gridTemplateColumns.value,
  gridTemplateRows: gridTemplateRows.value,
  gap: '4px',
}))

/** Inline style for the flat mode CSS Grid. */
const flatGridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, ${cellWidth.value}px)`,
  gridAutoRows: `${cellHeight.value}px`,
  gap: '4px',
}))

// --- Corner-based resize logic ---

const MIN_CELL_SIZE = 100
const MAX_CELL_SIZE = 600

const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartSize = ref(0)

function onResizeHandleMouseDown(event: MouseEvent) {
  event.preventDefault()
  isDragging.value = true
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  dragStartSize.value = props.cellSize

  document.addEventListener('mousemove', onDocumentMouseMove)
  document.addEventListener('mouseup', onDocumentMouseUp)
}

function onDocumentMouseMove(event: MouseEvent) {
  if (!isDragging.value) return

  const deltaX = event.clientX - dragStartX.value
  const deltaY = event.clientY - dragStartY.value

  // Calculate new size based on diagonal movement
  // When maintainAspectRatio is true or undefined (default), use average of deltas
  // When false, use max delta for freeform resize
  const shouldMaintainAspectRatio = props.maintainAspectRatio !== false
  const delta = shouldMaintainAspectRatio
    ? (deltaX + deltaY) / 2
    : Math.max(deltaX, deltaY)

  let newSize = Math.round(dragStartSize.value + delta)
  newSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, newSize))

  if (newSize !== props.cellSize) {
    emit('update:cellSize', newSize)
  }
}

function onDocumentMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDocumentMouseMove)
  document.removeEventListener('mouseup', onDocumentMouseUp)
}

onUnmounted(() => {
  // Clean up event listeners if component unmounts during drag
  document.removeEventListener('mousemove', onDocumentMouseMove)
  document.removeEventListener('mouseup', onDocumentMouseUp)
})
</script>

<template>
  <div class="xy-grid-container" v-if="!hasNoAxes">
    <div class="xy-grid" role="grid" :style="gridStyle">
      <!-- Corner resize handle -->
      <div
        class="xy-grid__resize-handle"
        role="button"
        tabindex="0"
        aria-label="Resize grid cells"
        :class="{ 'xy-grid__resize-handle--dragging': isDragging }"
        @mousedown="onResizeHandleMouseDown"
      ></div>
      <!-- Corner cell (when both X and Y present) -->
      <div
        v-if="xDimension && yDimension"
        class="xy-grid__corner"
        role="columnheader"
        :style="{ gridRow: 1, gridColumn: 1 }"
      ></div>

      <!-- Column headers -->
      <template v-if="xDimension">
        <div
          v-for="(xVal, idx) in xValues"
          :key="'ch-' + xVal"
          class="xy-grid__col-header"
          role="columnheader"
          :style="{ gridRow: 1, gridColumn: colIndex(idx) }"
          @click="onHeaderClick(xDimension!.name, xVal)"
        >
          {{ xVal }}
        </div>
      </template>

      <!-- Row headers + cells (Y dimension present) -->
      <template v-if="yDimension">
        <template v-for="(yVal, yIdx) in yValues" :key="'y-' + yVal">
          <!-- Row header -->
          <div
            class="xy-grid__row-header"
            role="rowheader"
            :style="{ gridRow: rowIndex(yIdx), gridColumn: 1 }"
            @click="onHeaderClick(yDimension!.name, yVal)"
          >
            {{ yVal }}
          </div>

          <!-- Cells for X+Y grid -->
          <template v-if="xDimension">
            <div
              v-for="(xVal, xIdx) in xValues"
              :key="xVal"
              class="xy-grid__cell"
              role="gridcell"
              :style="{ gridRow: rowIndex(yIdx), gridColumn: colIndex(xIdx) }"
            >
              <ImageCell
                :relative-path="getImage(xVal, yVal)?.relative_path ?? null"
                :slider-values="sliderDimension?.values"
                :current-slider-value="getSliderValue(xVal, yVal)"
                @click="(url: string) => onImageClick(xVal, yVal, url)"
                @slider:change="(v: string) => onSliderChange(xVal, yVal, v)"
              />
              <SliderBar
                v-if="sliderDimension"
                :values="sliderDimension.values"
                :current-value="getSliderValue(xVal, yVal)"
                :label="`${sliderDimension.name} for ${xVal}, ${yVal}`"
                @change="(v: string) => onSliderChange(xVal, yVal, v)"
              />
            </div>
          </template>

          <!-- Single cell for Y-only grid -->
          <div
            v-else
            class="xy-grid__cell"
            role="gridcell"
            :style="{ gridRow: rowIndex(yIdx), gridColumn: colBase }"
          >
            <ImageCell
              :relative-path="getImage(undefined, yVal)?.relative_path ?? null"
              :slider-values="sliderDimension?.values"
              :current-slider-value="getSliderValue(undefined, yVal)"
              @click="(url: string) => onImageClick(undefined, yVal, url)"
              @slider:change="(v: string) => onSliderChange(undefined, yVal, v)"
            />
            <SliderBar
              v-if="sliderDimension"
              :values="sliderDimension.values"
              :current-value="getSliderValue(undefined, yVal)"
              :label="`${sliderDimension.name} for ${yVal}`"
              @change="(v: string) => onSliderChange(undefined, yVal, v)"
            />
          </div>
        </template>
      </template>

      <!-- X-only cells (no Y dimension) -->
      <template v-else-if="xDimension">
        <div
          v-for="(xVal, xIdx) in xValues"
          :key="'xonly-' + xVal"
          class="xy-grid__cell"
          role="gridcell"
          :style="{ gridRow: rowBase, gridColumn: colIndex(xIdx) }"
        >
          <ImageCell
            :relative-path="getImage(xVal, undefined)?.relative_path ?? null"
            :slider-values="sliderDimension?.values"
            :current-slider-value="getSliderValue(xVal, undefined)"
            @click="(url: string) => onImageClick(xVal, undefined, url)"
            @slider:change="(v: string) => onSliderChange(xVal, undefined, v)"
          />
          <SliderBar
            v-if="sliderDimension"
            :values="sliderDimension.values"
            :current-value="getSliderValue(xVal, undefined)"
            :label="`${sliderDimension.name} for ${xVal}`"
            @change="(v: string) => onSliderChange(xVal, undefined, v)"
          />
        </div>
      </template>

    </div>
  </div>

  <!-- No axes: show flat image list -->
  <div class="xy-grid-flat" v-else-if="flatImages.length > 0">
    <div class="xy-grid-flat__grid" :style="flatGridStyle">
      <div
        v-for="img in flatImages"
        :key="img.relative_path"
        class="xy-grid-flat__cell"
      >
        <ImageCell
          :relative-path="img.relative_path"
          :slider-values="sliderDimension?.values"
          :current-slider-value="getSliderValue(undefined, undefined)"
          @click="(url: string) => onImageClick(undefined, undefined, url)"
          @slider:change="(v: string) => onSliderChange(undefined, undefined, v)"
        />
        <SliderBar
          v-if="sliderDimension"
          :values="sliderDimension.values"
          :current-value="getSliderValue(undefined, undefined)"
          :label="sliderDimension.name"
          @change="(v: string) => onSliderChange(undefined, undefined, v)"
        />
      </div>
    </div>
  </div>

  <div v-else class="xy-grid-empty">
    <p>No images to display. Assign dimensions to X or Y axis to build the grid.</p>
  </div>
</template>

<style scoped>
.xy-grid-container {
  width: 100%;
  position: relative;
}

.xy-grid {
  position: relative;
}

.xy-grid__corner {
  min-width: 60px;
}

.xy-grid__resize-handle {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 20px;
  height: 20px;
  background-color: var(--accent-color);
  border: 2px solid var(--bg-color);
  border-radius: 4px;
  cursor: nwse-resize;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.xy-grid__resize-handle:hover {
  transform: scale(1.2);
  background-color: var(--accent-bg);
  border-color: var(--accent-color);
}

.xy-grid__resize-handle--dragging {
  transform: scale(1.3);
  background-color: var(--accent-bg);
  border-color: var(--accent-color);
}

.xy-grid__resize-handle::before,
.xy-grid__resize-handle::after {
  content: '';
  position: absolute;
  background-color: var(--bg-color);
}

.xy-grid__resize-handle::before {
  width: 12px;
  height: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
}

.xy-grid__resize-handle::after {
  width: 2px;
  height: 12px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
}

.xy-grid__col-header {
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  text-align: center;
  font-size: 0.875rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.xy-grid__col-header:hover {
  background-color: var(--accent-bg);
}

.xy-grid__row-header {
  min-width: 60px;
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  font-size: 0.875rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}

.xy-grid__row-header:hover {
  background-color: var(--accent-bg);
}

.xy-grid__cell {
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.xy-grid-flat__cell {
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.xy-grid-empty {
  color: var(--text-secondary);
  padding: 2rem;
  text-align: center;
}
</style>

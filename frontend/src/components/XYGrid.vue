<script setup lang="ts">
import { computed } from 'vue'
import type { ScanDimension, ScanImage } from '../api/types'
import type { DebugCellInfo, GridNavItem, ImageClickContext } from './types'
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
  /** When true, each cell renders a debug overlay showing filtering parameters. */
  debugMode?: boolean
}>(), {
  debugMode: false,
})

// update:sliderValue: Emitted when a cell's slider changes. Payload: the cell key and new slider value.
// image:click: Emitted when a cell image is clicked. Payload: full click context including grid navigation info.
// header:click: Emitted when a row or column header is clicked. Payload: dimension name and value.
const emit = defineEmits<{
  'update:sliderValue': [cellKey: string, value: string]
  'image:click': [context: ImageClickContext]
  'header:click': [dimensionName: string, value: string]
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

/** Build debug info for a cell when debug mode is active. */
function getDebugInfo(xVal: string | undefined, yVal: string | undefined): DebugCellInfo | undefined {
  if (!props.debugMode) return undefined
  const comboEntries: Record<string, string[]> = {}
  for (const [dimName, selected] of Object.entries(props.comboSelections)) {
    // Exclude X and Y dimensions from combo display (already shown separately)
    if (dimName === props.xDimension?.name || dimName === props.yDimension?.name) continue
    // Exclude slider dimension (already shown separately)
    if (dimName === props.sliderDimension?.name) continue
    if (selected.size > 0) {
      comboEntries[dimName] = Array.from(selected)
    }
  }
  return {
    xValue: xVal,
    yValue: yVal,
    sliderValue: props.sliderDimension ? getSliderValue(xVal, yVal) : undefined,
    sliderDimensionName: props.sliderDimension?.name,
    comboSelections: comboEntries,
  }
}

/** Handle slider change for a cell. */
function onSliderChange(xVal: string | undefined, yVal: string | undefined, value: string) {
  const key = imageKey(xVal, yVal)
  emit('update:sliderValue', key, value)
}

/** Build a map from slider value → full-resolution image URL for a given cell (all slider positions).
 *  Always uses the full-resolution PNG path so the lightbox displays images at full quality. */
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
        debugInfo: getDebugInfo(undefined, undefined),
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
          debugInfo: getDebugInfo(xVal, yVal),
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
        debugInfo: getDebugInfo(xVal, undefined),
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
        debugInfo: getDebugInfo(undefined, yVal),
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
  // Column count for Y-axis keyboard navigation: number of visible X values.
  // 0 when there is no X dimension (Y-only or flat mode).
  const gridColumnCount = props.xDimension ? xValues.value.length : 0
  emit('image:click', {
    imageUrl,
    cellKey: key,
    sliderValues: sliderVals,
    currentSliderValue: currentSliderVal,
    imagesBySliderValue,
    gridImages,
    gridIndex: gridIndex >= 0 ? gridIndex : 0,
    gridColumnCount,
    debugInfo: getDebugInfo(xVal, yVal),
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

</script>

<template>
  <div class="xy-grid-container" v-if="!hasNoAxes">
    <div class="xy-grid" role="grid" :style="gridStyle">
      <!-- Header row: corner cell + column headers (role="row" with display:contents keeps CSS grid intact) -->
      <div v-if="xDimension" role="row" class="xy-grid__row--header">
        <!-- Corner cell (when both X and Y present) -->
        <div
          v-if="yDimension"
          class="xy-grid__corner"
          role="columnheader"
          :style="{ gridRow: 1, gridColumn: 1 }"
        ></div>

        <!-- Column headers -->
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
      </div>

      <!-- Row headers + cells (Y dimension present) -->
      <template v-if="yDimension">
        <!-- Each data row is wrapped in role="row" with display:contents to satisfy ARIA without breaking CSS grid -->
        <div
          v-for="(yVal, yIdx) in yValues"
          :key="'y-' + yVal"
          role="row"
          class="xy-grid__row--data"
        >
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
                :thumbnail-path="getImage(xVal, yVal)?.thumbnail_path || undefined"
                :slider-values="sliderDimension?.values"
                :current-slider-value="getSliderValue(xVal, yVal)"
                :debug-info="getDebugInfo(xVal, yVal)"
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
              :thumbnail-path="getImage(undefined, yVal)?.thumbnail_path || undefined"
              :slider-values="sliderDimension?.values"
              :current-slider-value="getSliderValue(undefined, yVal)"
              :debug-info="getDebugInfo(undefined, yVal)"
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
        </div>
      </template>

      <!-- X-only cells (no Y dimension) — single data row -->
      <template v-else-if="xDimension">
        <div role="row" class="xy-grid__row--data">
          <div
            v-for="(xVal, xIdx) in xValues"
            :key="'xonly-' + xVal"
            class="xy-grid__cell"
            role="gridcell"
            :style="{ gridRow: rowBase, gridColumn: colIndex(xIdx) }"
          >
            <ImageCell
              :relative-path="getImage(xVal, undefined)?.relative_path ?? null"
              :thumbnail-path="getImage(xVal, undefined)?.thumbnail_path || undefined"
              :slider-values="sliderDimension?.values"
              :current-slider-value="getSliderValue(xVal, undefined)"
              :debug-info="getDebugInfo(xVal, undefined)"
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
          :thumbnail-path="img.thumbnail_path || undefined"
          :slider-values="sliderDimension?.values"
          :current-slider-value="getSliderValue(undefined, undefined)"
          :debug-info="getDebugInfo(undefined, undefined)"
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

/* ARIA row wrappers use display:contents so they are invisible to CSS grid layout
   but present in the accessibility tree — satisfies aria-required-parent/children. */
.xy-grid__row--header,
.xy-grid__row--data {
  display: contents;
}

.xy-grid__corner {
  min-width: 60px;
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

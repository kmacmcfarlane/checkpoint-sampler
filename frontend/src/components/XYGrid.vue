<script setup lang="ts">
import { computed } from 'vue'
import { useImageCubeStore } from '../stores/imageCube'
import type { DebugCellInfo, GridNavItem, ImageClickContext } from './types'
import ImageCell from './ImageCell.vue'
import SliderBar from './SliderBar.vue'

const props = withDefaults(defineProps<{
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

const store = useImageCubeStore()

// --- Store-backed derivations (no local recomputation) ---
const xDimension = computed(() => store.xDimension)
const yDimension = computed(() => store.yDimension)
const sliderDimension = computed(() => store.sliderDimension)
const xValues = computed(() => store.xValues)
const yValues = computed(() => store.yValues)
const hasNoAxes = computed(() => store.hasNoAxes)

// --- Cell dimensions controlled by zoom ---
const cellWidth = computed(() => props.cellSize)
const cellHeight = computed(() => props.cellSize)

function onHeaderClick(dimensionName: string, value: string) {
  emit('header:click', dimensionName, value)
}

/** Get the image for a specific x/y combination (store-backed). */
function getImage(xVal: string | undefined, yVal: string | undefined) {
  return store.getImage(xVal, yVal)
}

/** Get the current slider value for a given cell (store-backed). */
function getSliderValue(xVal: string | undefined, yVal: string | undefined): string {
  return store.getCellSliderValue(xVal, yVal)
}

/** Build debug info for a cell when debug mode is active. */
function getDebugInfo(xVal: string | undefined, yVal: string | undefined): DebugCellInfo | undefined {
  if (!props.debugMode) return undefined
  const comboEntries: Record<string, string[]> = {}
  for (const [dimName, selected] of Object.entries(store.comboSelections)) {
    // Exclude X and Y dimensions from combo display (already shown separately)
    if (dimName === xDimension.value?.name || dimName === yDimension.value?.name) continue
    // Exclude slider dimension (already shown separately)
    if (dimName === sliderDimension.value?.name) continue
    if (selected.size > 0) {
      comboEntries[dimName] = Array.from(selected)
    }
  }
  return {
    xValue: xVal,
    yValue: yVal,
    sliderValue: sliderDimension.value ? getSliderValue(xVal, yVal) : undefined,
    sliderDimensionName: sliderDimension.value?.name,
    comboSelections: comboEntries,
  }
}

/** Handle slider change for a cell. */
function onSliderChange(xVal: string | undefined, yVal: string | undefined, value: string) {
  const key = store.cellKey(xVal, yVal)
  emit('update:sliderValue', key, value)
}

/**
 * Build the ordered list of all visible grid cells that have images,
 * for lightbox grid navigation. Extends store gridNavItems with debugInfo.
 */
function buildGridNavItems(): GridNavItem[] {
  const storeItems = store.gridNavItems
  if (!props.debugMode) return storeItems

  // Enrich with debugInfo by parsing cellKey back to x/y values
  return storeItems.map((item) => {
    const [xVal, yVal] = parseCellKey(item.cellKey)
    return {
      ...item,
      debugInfo: getDebugInfo(xVal, yVal),
    }
  })
}

/** Parse a cellKey ("xVal|yVal") back into x and y values. */
function parseCellKey(key: string | null): [string | undefined, string | undefined] {
  if (!key) return [undefined, undefined]
  const sep = key.indexOf('|')
  if (sep < 0) return [undefined, undefined]
  const x = key.substring(0, sep)
  const y = key.substring(sep + 1)
  return [x || undefined, y || undefined]
}

/** Emit an image:click event with full cell context. */
function onImageClick(xVal: string | undefined, yVal: string | undefined, imageUrl: string) {
  const key = store.cellKey(xVal, yVal)
  const sliderVals = sliderDimension.value?.values ?? []
  const currentSliderVal = getSliderValue(xVal, yVal)
  const imagesBySliderValue = store.getImagesBySliderValue(xVal, yVal)
  const gridImages = buildGridNavItems()
  const gridIndex = gridImages.findIndex((item) => item.cellKey === key && item.imageUrl === imageUrl)
  // Column count for Y-axis keyboard navigation: number of visible X values.
  // 0 when there is no X dimension (Y-only or flat mode).
  const gridColumnCount = store.gridColumnCount
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

/** When no axes are assigned, show all filtered images in a flat list. */
const flatImages = computed(() => {
  if (!hasNoAxes.value) return []
  // Apply slider filter to flat images too
  if (sliderDimension.value) {
    const sliderDimName = sliderDimension.value.name
    const expectedVal = store.getCellSliderValue(undefined, undefined)
    return store.filteredImages.filter((img) => {
      const val = img.dimensions[sliderDimName]
      return val === undefined || val === expectedVal
    })
  }
  return store.filteredImages
})

// --- CSS Grid placement helpers ---

/** Column offset: data columns start at 2 when row headers present, else 1. */
const colBase = computed(() => (yDimension.value ? 2 : 1))

/** Row offset: data rows start at 2 when column headers present, else 1. */
const rowBase = computed(() => (xDimension.value ? 2 : 1))

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
  if (yDimension.value) parts.push('auto')
  if (xDimension.value) {
    for (let i = 0; i < xValues.value.length; i++) {
      parts.push(`${cellWidth.value}px`)
    }
  } else if (yDimension.value) {
    parts.push(`${cellWidth.value}px`)
  }
  return parts.join(' ')
})

/** Computed grid-template-rows. */
const gridTemplateRows = computed(() => {
  const parts: string[] = []
  if (xDimension.value) parts.push('auto')
  if (yDimension.value) {
    for (let j = 0; j < yValues.value.length; j++) {
      parts.push(`${cellHeight.value}px`)
    }
  } else if (xDimension.value) {
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
          data-testid="xy-grid-col-header"
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

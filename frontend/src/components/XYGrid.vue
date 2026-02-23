<script setup lang="ts">
import { computed } from 'vue'
import type { ScanDimension, ScanImage } from '../api/types'
import ImageCell from './ImageCell.vue'
import SliderBar from './SliderBar.vue'

const props = defineProps<{
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
}>()

const emit = defineEmits<{
  'update:sliderValue': [cellKey: string, value: string]
  'image:click': [imageUrl: string]
  'header:click': [dimensionName: string, value: string]
}>()

// --- Cell dimensions controlled by zoom ---
const cellWidth = computed(() => props.cellSize)
const cellHeight = computed(() => props.cellSize)

function onHeaderClick(dimensionName: string, value: string) {
  emit('header:click', dimensionName, value)
}

/** X axis values to render as columns. */
const xValues = computed(() => props.xDimension?.values ?? [])

/** Y axis values to render as rows. */
const yValues = computed(() => props.yDimension?.values ?? [])

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
              <ImageCell :relative-path="getImage(xVal, yVal)?.relative_path ?? null" @click="(url: string) => emit('image:click', url)" />
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
            <ImageCell :relative-path="getImage(undefined, yVal)?.relative_path ?? null" @click="(url: string) => emit('image:click', url)" />
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
          <ImageCell :relative-path="getImage(xVal, undefined)?.relative_path ?? null" @click="(url: string) => emit('image:click', url)" />
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
        <ImageCell :relative-path="img.relative_path" @click="(url: string) => emit('image:click', url)" />
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
}

.xy-grid__corner {
  min-width: 60px;
}

.xy-grid__col-header {
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  text-align: center;
  font-size: 0.875rem;
  background-color: var(--bg-surface, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.xy-grid__col-header:hover {
  background-color: var(--accent-bg, #e3f2fd);
}

.xy-grid__row-header {
  min-width: 60px;
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  font-size: 0.875rem;
  background-color: var(--bg-surface, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}

.xy-grid__row-header:hover {
  background-color: var(--accent-bg, #e3f2fd);
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
  color: var(--text-secondary, #666);
  padding: 2rem;
  text-align: center;
}
</style>

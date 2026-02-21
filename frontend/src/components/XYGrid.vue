<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'
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
}>()

const emit = defineEmits<{
  'update:sliderValue': [cellKey: string, value: string]
  'image:click': [imageUrl: string]
  'header:click': [dimensionName: string, value: string]
}>()

// --- Resizable cell dimensions ---
const cellWidth = ref(200)
const cellHeight = ref(200)

let resizeStartX = 0
let resizeStartY = 0
let resizeStartWidth = 0
let resizeStartHeight = 0

function onColDividerMousedown(e: MouseEvent) {
  e.preventDefault()
  resizeStartX = e.clientX
  resizeStartWidth = cellWidth.value
  document.addEventListener('mousemove', onColDividerMousemove)
  document.addEventListener('mouseup', onColDividerMouseup)
}

function onColDividerMousemove(e: MouseEvent) {
  const delta = e.clientX - resizeStartX
  const xCount = props.xDimension?.values.length ?? 1
  cellWidth.value = Math.max(100, resizeStartWidth + delta / xCount)
}

function onColDividerMouseup() {
  document.removeEventListener('mousemove', onColDividerMousemove)
  document.removeEventListener('mouseup', onColDividerMouseup)
}

function onRowDividerMousedown(e: MouseEvent) {
  e.preventDefault()
  resizeStartY = e.clientY
  resizeStartHeight = cellHeight.value
  document.addEventListener('mousemove', onRowDividerMousemove)
  document.addEventListener('mouseup', onRowDividerMouseup)
}

function onRowDividerMousemove(e: MouseEvent) {
  const delta = e.clientY - resizeStartY
  const yCount = props.yDimension?.values.length ?? 1
  cellHeight.value = Math.max(100, resizeStartHeight + delta / yCount)
}

function onRowDividerMouseup() {
  document.removeEventListener('mousemove', onRowDividerMousemove)
  document.removeEventListener('mouseup', onRowDividerMouseup)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onColDividerMousemove)
  document.removeEventListener('mouseup', onColDividerMouseup)
  document.removeEventListener('mousemove', onRowDividerMousemove)
  document.removeEventListener('mouseup', onRowDividerMouseup)
})

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
</script>

<template>
  <div class="xy-grid-container" v-if="!hasNoAxes">
    <div class="xy-grid" role="grid">
      <!-- Header row with X values -->
      <div class="xy-grid__header-row" role="row" v-if="xDimension">
        <div class="xy-grid__corner" v-if="yDimension" role="columnheader"></div>
        <template v-for="(xVal, idx) in xValues" :key="xVal">
          <div
            class="xy-grid__col-header"
            role="columnheader"
            :style="{ width: cellWidth + 'px' }"
            @click="onHeaderClick(xDimension!.name, xVal)"
          >
            {{ xVal }}
          </div>
          <div
            v-if="idx < xValues.length - 1"
            class="xy-grid__col-divider"
            role="separator"
            aria-orientation="vertical"
            @mousedown="onColDividerMousedown"
          ></div>
        </template>
      </div>

      <!-- Data rows -->
      <template v-if="yDimension">
        <template v-for="(yVal, yIdx) in yValues" :key="yVal">
          <div class="xy-grid__row" role="row">
            <div
              class="xy-grid__row-header"
              role="rowheader"
              :style="{ height: cellHeight + 'px' }"
              @click="onHeaderClick(yDimension!.name, yVal)"
            >
              {{ yVal }}
            </div>
            <template v-if="xDimension">
              <template v-for="(xVal, xIdx) in xValues" :key="xVal">
                <div
                  class="xy-grid__cell"
                  role="gridcell"
                  :style="{ width: cellWidth + 'px', height: cellHeight + 'px' }"
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
                <div
                  v-if="xIdx < xValues.length - 1"
                  class="xy-grid__col-divider xy-grid__col-divider--cell"
                  @mousedown="onColDividerMousedown"
                ></div>
              </template>
            </template>
            <template v-else>
              <div
                class="xy-grid__cell"
                role="gridcell"
                :style="{ height: cellHeight + 'px' }"
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
          </div>
          <div
            v-if="yIdx < yValues.length - 1"
            class="xy-grid__row-divider"
            role="separator"
            aria-orientation="horizontal"
            @mousedown="onRowDividerMousedown"
          ></div>
        </template>
      </template>

      <!-- X-only row (no Y dimension) -->
      <div v-else-if="xDimension" class="xy-grid__row" role="row">
        <template v-for="(xVal, xIdx) in xValues" :key="xVal">
          <div
            class="xy-grid__cell"
            role="gridcell"
            :style="{ width: cellWidth + 'px' }"
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
          <div
            v-if="xIdx < xValues.length - 1"
            class="xy-grid__col-divider xy-grid__col-divider--cell"
            @mousedown="onColDividerMousedown"
          ></div>
        </template>
      </div>
    </div>
  </div>

  <!-- No axes: show flat image list -->
  <div class="xy-grid-flat" v-else-if="flatImages.length > 0">
    <div class="xy-grid-flat__grid">
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

.xy-grid {
  display: inline-block;
}

.xy-grid__header-row {
  display: flex;
  align-items: stretch;
}

.xy-grid__corner {
  min-width: 100px;
  flex-shrink: 0;
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
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.xy-grid__col-header:hover {
  background-color: var(--accent-bg, #e3f2fd);
}

.xy-grid__col-divider {
  width: 6px;
  cursor: col-resize;
  background-color: transparent;
  flex-shrink: 0;
}

.xy-grid__col-divider:hover {
  background-color: var(--accent-color, #1976d2);
  opacity: 0.3;
}

.xy-grid__row {
  display: flex;
  align-items: stretch;
  margin-top: 0;
}

.xy-grid__row-divider {
  height: 6px;
  cursor: row-resize;
  background-color: transparent;
}

.xy-grid__row-divider:hover {
  background-color: var(--accent-color, #1976d2);
  opacity: 0.3;
}

.xy-grid__row-header {
  min-width: 100px;
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  font-size: 0.875rem;
  background-color: var(--bg-surface, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}

.xy-grid__row-header:hover {
  background-color: var(--accent-bg, #e3f2fd);
}

.xy-grid__cell {
  flex-shrink: 0;
  overflow: hidden;
}

.xy-grid-flat__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.xy-grid-flat__cell {
  width: 200px;
}

.xy-grid-empty {
  color: var(--text-secondary, #666);
  padding: 2rem;
  text-align: center;
}
</style>

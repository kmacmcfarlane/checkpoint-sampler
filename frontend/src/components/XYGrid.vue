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
}>()

const emit = defineEmits<{
  'update:sliderValue': [cellKey: string, value: string]
  'image:click': [imageUrl: string]
}>()

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
        <div
          v-for="xVal in xValues"
          :key="xVal"
          class="xy-grid__col-header"
          role="columnheader"
        >
          {{ xVal }}
        </div>
      </div>

      <!-- Data rows -->
      <template v-if="yDimension">
        <div
          v-for="yVal in yValues"
          :key="yVal"
          class="xy-grid__row"
          role="row"
        >
          <div class="xy-grid__row-header" role="rowheader">{{ yVal }}</div>
          <template v-if="xDimension">
            <div
              v-for="xVal in xValues"
              :key="xVal"
              class="xy-grid__cell"
              role="gridcell"
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
          <template v-else>
            <div class="xy-grid__cell" role="gridcell">
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
      </template>

      <!-- X-only row (no Y dimension) -->
      <div v-else-if="xDimension" class="xy-grid__row" role="row">
        <div
          v-for="xVal in xValues"
          :key="xVal"
          class="xy-grid__cell"
          role="gridcell"
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
  overflow: auto;
  max-width: 100%;
  max-height: calc(100vh - 200px);
}

.xy-grid {
  display: inline-block;
}

.xy-grid__header-row {
  display: flex;
  gap: 2px;
}

.xy-grid__corner {
  min-width: 100px;
  flex-shrink: 0;
}

.xy-grid__col-header {
  min-width: 200px;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  text-align: center;
  font-size: 0.875rem;
  background-color: var(--bg-surface, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
}

.xy-grid__row {
  display: flex;
  gap: 2px;
  margin-top: 2px;
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
}

.xy-grid__cell {
  min-width: 200px;
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

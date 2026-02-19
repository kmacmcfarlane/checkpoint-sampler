<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import type { TrainingRun, DimensionRole } from './api/types'
import { apiClient } from './api/client'
import { useDimensionMapping } from './composables/useDimensionMapping'
import { useImagePreloader } from './composables/useImagePreloader'
import TrainingRunSelector from './components/TrainingRunSelector.vue'
import DimensionPanel from './components/DimensionPanel.vue'
import XYGrid from './components/XYGrid.vue'
import ComboFilter from './components/ComboFilter.vue'
import MasterSlider from './components/MasterSlider.vue'

const selectedTrainingRun = ref<TrainingRun | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)

const {
  dimensions,
  images,
  assignments,
  xDimension,
  yDimension,
  sliderDimension,
  comboDimensions,
  setScanResult,
  assignRole,
} = useDimensionMapping()

/** Combo filter selections: dimension name → set of selected values. */
const comboSelections = reactive<Record<string, Set<string>>>({})

/** Slider values per grid cell (key = "xVal|yVal"). */
const sliderValues = reactive<Record<string, string>>({})

/** Wrap reactive comboSelections as a computed ref for the preloader. */
const comboSelectionsRef = computed(() => comboSelections as Record<string, Set<string>>)

/** Pre-cache images: slider positions for visible cells first, then remaining. */
useImagePreloader(images, xDimension, yDimension, sliderDimension, comboSelectionsRef)

async function onTrainingRunSelect(run: TrainingRun) {
  selectedTrainingRun.value = run
  scanning.value = true
  scanError.value = null

  // Reset combo selections and slider values
  for (const key of Object.keys(comboSelections)) {
    delete comboSelections[key]
  }
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }

  try {
    const result = await apiClient.scanTrainingRun(run.id)
    setScanResult(result)
    // Initialize combo selections: all values selected by default
    for (const dim of result.dimensions) {
      comboSelections[dim.name] = new Set(dim.values)
    }
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to scan training run'
    scanError.value = message
  } finally {
    scanning.value = false
  }
}

function onAssignRole(dimensionName: string, role: DimensionRole) {
  assignRole(dimensionName, role)
}

function onComboUpdate(dimensionName: string, selected: Set<string>) {
  comboSelections[dimensionName] = selected
}

/** Master slider value ref. */
const masterSliderValue = ref<string>('')

/** Default slider value: master value if set, otherwise first value of slider dimension. */
const defaultSliderValue = computed(() => {
  if (masterSliderValue.value) return masterSliderValue.value
  return sliderDimension.value?.values[0] ?? ''
})

// Reset master slider value when slider dimension changes
watch(sliderDimension, (dim) => {
  masterSliderValue.value = dim?.values[0] ?? ''
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }
})

/** Update a single cell's slider value. */
function onSliderValueUpdate(cellKey: string, value: string) {
  sliderValues[cellKey] = value
}

/** Master slider changes all cell slider values in sync. */
function onMasterSliderChange(value: string) {
  masterSliderValue.value = value
  // Clear per-cell overrides so all cells follow the master
  for (const key of Object.keys(sliderValues)) {
    delete sliderValues[key]
  }
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Checkpoint Sampler</h1>
      <TrainingRunSelector @select="onTrainingRunSelect" />
    </header>
    <main class="app-main">
      <p v-if="!selectedTrainingRun">Select a training run to get started.</p>
      <template v-else>
        <p v-if="scanning">Scanning...</p>
        <p v-else-if="scanError" class="error" role="alert">{{ scanError }}</p>
        <template v-else>
          <DimensionPanel
            :dimensions="dimensions"
            :assignments="assignments"
            @assign="onAssignRole"
          />
          <div class="combo-filters" v-if="comboDimensions.length > 0">
            <ComboFilter
              v-for="dim in comboDimensions"
              :key="dim.name"
              :dimension-name="dim.name"
              :values="dim.values"
              :selected="comboSelections[dim.name] ?? new Set()"
              @update="onComboUpdate"
            />
          </div>
          <MasterSlider
            v-if="sliderDimension"
            :values="sliderDimension.values"
            :current-value="defaultSliderValue"
            :dimension-name="sliderDimension.name"
            @change="onMasterSliderChange"
          />
          <XYGrid
            :x-dimension="xDimension"
            :y-dimension="yDimension"
            :images="images"
            :combo-selections="comboSelections"
            :slider-dimension="sliderDimension"
            :slider-values="sliderValues"
            :default-slider-value="defaultSliderValue"
            @update:slider-value="onSliderValueUpdate"
          />
        </template>
      </template>
    </main>
  </div>
</template>

<style scoped>
.app {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 100vw;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.app-main {
  padding: 1rem;
  flex: 1;
}

.combo-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.error {
  color: #d32f2f;
}
</style>

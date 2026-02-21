<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { NConfigProvider, NButton, NTag } from 'naive-ui'
import type { TrainingRun, DimensionRole, Preset } from './api/types'
import { apiClient } from './api/client'
import { useDimensionMapping } from './composables/useDimensionMapping'
import { useImagePreloader } from './composables/useImagePreloader'
import { useWebSocket } from './composables/useWebSocket'
import TrainingRunSelector from './components/TrainingRunSelector.vue'
import DimensionPanel from './components/DimensionPanel.vue'
import XYGrid from './components/XYGrid.vue'
import ComboFilter from './components/ComboFilter.vue'
import MasterSlider from './components/MasterSlider.vue'
import PresetSelector from './components/PresetSelector.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import CheckpointMetadataPanel from './components/CheckpointMetadataPanel.vue'

const selectedTrainingRun = ref<TrainingRun | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const lightboxImageUrl = ref<string | null>(null)
const metadataPanelOpen = ref(false)

function onImageClick(imageUrl: string) {
  lightboxImageUrl.value = imageUrl
}

function onLightboxClose() {
  lightboxImageUrl.value = null
}

const {
  dimensions,
  images,
  assignments,
  xDimension,
  yDimension,
  sliderDimension,
  setScanResult,
  assignRole,
  addImage,
  removeImage,
} = useDimensionMapping()

/** Preset warnings for unmatched dimensions. */
const presetWarnings = ref<string[]>([])

/** Combo filter selections: dimension name → set of selected values. */
const comboSelections = reactive<Record<string, Set<string>>>({})

/** Slider values per grid cell (key = "xVal|yVal"). */
const sliderValues = reactive<Record<string, string>>({})

/** Wrap reactive comboSelections as a computed ref for the preloader. */
const comboSelectionsRef = computed(() => comboSelections as Record<string, Set<string>>)

/** Pre-cache images: slider positions for visible cells first, then remaining. */
useImagePreloader(images, xDimension, yDimension, sliderDimension, comboSelectionsRef)

/** Rescan the current training run (used by WebSocket on directory_added). */
async function rescanCurrentTrainingRun() {
  const run = selectedTrainingRun.value
  if (!run) return
  try {
    const result = await apiClient.scanTrainingRun(run.id)
    setScanResult(result)
    // Reinitialize combo selections: all values selected by default
    for (const key of Object.keys(comboSelections)) {
      delete comboSelections[key]
    }
    for (const dim of result.dimensions) {
      comboSelections[dim.name] = new Set(dim.values)
    }
  } catch {
    // Silently ignore rescan failures from WebSocket events
  }
}

/** WebSocket live updates: connect when a training run is selected. */
const { connected: wsConnected } = useWebSocket(
  selectedTrainingRun,
  addImage,
  removeImage,
  comboSelections,
  rescanCurrentTrainingRun,
)

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

/** All dimension names from the current scan. */
const dimensionNames = computed(() => dimensions.value.map((d) => d.name))

/** Load a preset: apply matching dimension assignments, warn about unmatched. */
function onPresetLoad(preset: Preset, warnings: string[]) {
  presetWarnings.value = warnings
  // Apply the preset mapping to assignments
  const m = preset.mapping
  for (const dim of dimensions.value) {
    if (m.x === dim.name) {
      assignRole(dim.name, 'x')
    } else if (m.y === dim.name) {
      assignRole(dim.name, 'y')
    } else if (m.slider === dim.name) {
      assignRole(dim.name, 'slider')
    } else {
      assignRole(dim.name, 'none')
    }
  }
}

function onPresetSave() {
  presetWarnings.value = []
}

function onPresetDelete() {
  presetWarnings.value = []
}
</script>

<template>
  <NConfigProvider>
    <div class="app">
      <header class="app-header">
        <h1>Checkpoint Sampler</h1>
        <div class="header-controls">
          <TrainingRunSelector @select="onTrainingRunSelect" />
          <NButton
            v-if="selectedTrainingRun && !scanning && !scanError"
            size="small"
            aria-label="Toggle checkpoint metadata panel"
            @click="metadataPanelOpen = !metadataPanelOpen"
          >Metadata</NButton>
          <NTag
            v-if="selectedTrainingRun"
            :type="wsConnected ? 'success' : 'default'"
            size="small"
            :title="wsConnected ? 'Live updates connected' : 'Live updates disconnected'"
            role="status"
          >{{ wsConnected ? 'Live' : 'Disconnected' }}</NTag>
        </div>
      </header>
      <main class="app-main">
        <p v-if="!selectedTrainingRun">Select a training run to get started.</p>
        <template v-else>
          <p v-if="scanning">Scanning...</p>
          <p v-else-if="scanError" class="error" role="alert">{{ scanError }}</p>
          <template v-else>
            <PresetSelector
              :assignments="assignments"
              :dimension-names="dimensionNames"
              @load="onPresetLoad"
              @save="onPresetSave"
              @delete="onPresetDelete"
            />
            <p v-if="presetWarnings.length > 0" class="warning" role="status">
              Unmatched dimensions from preset: {{ presetWarnings.join(', ') }}
            </p>
            <DimensionPanel
              :dimensions="dimensions"
              :assignments="assignments"
              @assign="onAssignRole"
            />
            <div class="combo-filters" v-if="dimensions.length > 0">
              <ComboFilter
                v-for="dim in dimensions"
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
              @image:click="onImageClick"
            />
          </template>
        </template>
      </main>
      <ImageLightbox
        v-if="lightboxImageUrl"
        :image-url="lightboxImageUrl"
        @close="onLightboxClose"
      />
      <CheckpointMetadataPanel
        v-if="metadataPanelOpen && selectedTrainingRun"
        :checkpoints="selectedTrainingRun.checkpoints"
        @close="metadataPanelOpen = false"
      />
    </div>
  </NConfigProvider>
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

.warning {
  color: #f57c00;
  font-size: 0.875rem;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>

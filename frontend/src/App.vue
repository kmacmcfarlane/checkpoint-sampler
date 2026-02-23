<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { NConfigProvider, NButton, NTag } from 'naive-ui'
import type { TrainingRun, DimensionRole, FilterMode, Preset } from './api/types'
import { apiClient } from './api/client'
import { useDimensionMapping } from './composables/useDimensionMapping'
import { useImagePreloader } from './composables/useImagePreloader'
import { useWebSocket } from './composables/useWebSocket'
import { useTheme } from './composables/useTheme'
import AppDrawer from './components/AppDrawer.vue'
import TrainingRunSelector from './components/TrainingRunSelector.vue'
import DimensionPanel from './components/DimensionPanel.vue'
import XYGrid from './components/XYGrid.vue'
import DimensionFilter from './components/DimensionFilter.vue'
import MasterSlider from './components/MasterSlider.vue'
import ZoomControl from './components/ZoomControl.vue'
import PresetSelector from './components/PresetSelector.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import CheckpointMetadataPanel from './components/CheckpointMetadataPanel.vue'
import ThemeToggle from './components/ThemeToggle.vue'

const { theme, isDark, toggle: toggleTheme } = useTheme()

const selectedTrainingRun = ref<TrainingRun | null>(null)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const lightboxImageUrl = ref<string | null>(null)
const metadataPanelOpen = ref(false)
const drawerOpen = ref(false)

const WIDE_BREAKPOINT = 1024

function initDrawerState() {
  drawerOpen.value = window.innerWidth >= WIDE_BREAKPOINT
}

let mediaQuery: MediaQueryList | null = null

function onMediaChange(e: MediaQueryListEvent) {
  drawerOpen.value = e.matches
}

onMounted(() => {
  initDrawerState()
  mediaQuery = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`)
  mediaQuery.addEventListener('change', onMediaChange)
})

onUnmounted(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onMediaChange)
  }
})

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

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
  filterModes,
  xDimension,
  yDimension,
  sliderDimension,
  setScanResult,
  assignRole,
  setFilterMode,
  getFilterMode,
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

function onFilterModeChange(dimensionName: string, mode: FilterMode) {
  const prevMode = getFilterMode(dimensionName)
  setFilterMode(dimensionName, mode)

  // When switching to 'single', reduce selection to one value
  if (mode === 'single' && prevMode !== 'single') {
    const current = comboSelections[dimensionName]
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      // Pick first previously-selected value that's still valid, or first value
      let singleVal = dim.values[0]
      if (current) {
        for (const v of current) {
          if (dim.values.includes(v)) {
            singleVal = v
            break
          }
        }
      }
      comboSelections[dimensionName] = new Set(singleVal ? [singleVal] : [])
    }
  }

  // When switching to 'hide', restore all values (include everything)
  if (mode === 'hide') {
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      comboSelections[dimensionName] = new Set(dim.values)
    }
  }

  // When switching to 'multi' from 'hide', start with all values selected
  if (mode === 'multi' && prevMode === 'hide') {
    const dim = dimensions.value.find((d) => d.name === dimensionName)
    if (dim) {
      comboSelections[dimensionName] = new Set(dim.values)
    }
  }
}

function onFilterUpdate(dimensionName: string, selected: Set<string>) {
  comboSelections[dimensionName] = selected
}

/** Handle header click from XYGrid: solo/unsolo a value in the dimension's filter. */
function onHeaderClick(dimensionName: string, value: string) {
  const dim = dimensions.value.find((d) => d.name === dimensionName)
  if (!dim) return
  const current = comboSelections[dimensionName]
  // If only this value is selected, re-select all (unsolo)
  if (current && current.size === 1 && current.has(value)) {
    comboSelections[dimensionName] = new Set(dim.values)
  } else {
    // Solo: select only this value
    comboSelections[dimensionName] = new Set([value])
  }
}

/** Master slider value ref. */
const masterSliderValue = ref<string>('')

/** Default slider value: master value if set, otherwise first value of slider dimension. */
const defaultSliderValue = computed(() => {
  if (masterSliderValue.value) return masterSliderValue.value
  return sliderDimension.value?.values[0] ?? ''
})

/** Cell size for grid zoom control. */
const cellSize = ref(200)

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
  <NConfigProvider :theme="theme">
    <div class="app" :class="{ 'dark-mode': isDark }">
      <header class="app-header">
        <div class="header-left">
          <NButton
            quaternary
            size="small"
            aria-label="Toggle controls drawer"
            @click="toggleDrawer"
          >
            <span class="hamburger-icon">&#9776;</span>
          </NButton>
          <h1>Checkpoint Sampler</h1>
        </div>
        <div class="header-controls">
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
          <ThemeToggle :is-dark="isDark" @toggle="toggleTheme" />
        </div>
      </header>
      <AppDrawer v-model:show="drawerOpen">
        <div class="drawer-section">
          <TrainingRunSelector @select="onTrainingRunSelect" />
        </div>
        <template v-if="selectedTrainingRun && !scanning && !scanError">
          <div class="drawer-section">
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
          </div>
          <div class="drawer-section">
            <DimensionPanel
              :dimensions="dimensions"
              :assignments="assignments"
              :filter-modes="filterModes"
              @assign="onAssignRole"
              @update:filter-mode="onFilterModeChange"
            />
          </div>
        </template>
      </AppDrawer>
      <main class="app-main">
        <p v-if="!selectedTrainingRun">Select a training run to get started.</p>
        <template v-else>
          <p v-if="scanning">Scanning...</p>
          <p v-else-if="scanError" class="error" role="alert">{{ scanError }}</p>
          <template v-else>
            <div class="dimension-filters" v-if="dimensions.length > 0">
              <DimensionFilter
                v-for="dim in dimensions"
                :key="dim.name"
                :dimension-name="dim.name"
                :values="dim.values"
                :selected="comboSelections[dim.name] ?? new Set()"
                :filter-mode="getFilterMode(dim.name)"
                @update="onFilterUpdate"
              />
            </div>
            <div class="controls-sticky">
              <ZoomControl
                :cell-size="cellSize"
                @update:cell-size="cellSize = $event"
              />
              <MasterSlider
                v-if="sliderDimension"
                :values="sliderDimension.values"
                :current-value="defaultSliderValue"
                :dimension-name="sliderDimension.name"
                @change="onMasterSliderChange"
              />
            </div>
            <XYGrid
              :x-dimension="xDimension"
              :y-dimension="yDimension"
              :images="images"
              :combo-selections="comboSelections"
              :slider-dimension="sliderDimension"
              :slider-values="sliderValues"
              :default-slider-value="defaultSliderValue"
              :cell-size="cellSize"
              @update:slider-value="onSliderValueUpdate"
              @image:click="onImageClick"
              @header:click="onHeaderClick"
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
  --border-color: #e0e0e0;
  --bg-color: #ffffff;
  --text-color: #333333;
  --text-secondary: #666666;
  --bg-surface: #f5f5f5;
  --error-color: #d32f2f;
  --warning-color: #f57c00;
  --accent-color: #1976d2;
  --accent-bg: #e3f2fd;

  font-family: system-ui, -apple-system, sans-serif;
  max-width: 100vw;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color);
  color: var(--text-color);
  overflow-x: hidden;
}

.app.dark-mode {
  --border-color: #3a3a3a;
  --bg-color: #1a1a1a;
  --text-color: #e0e0e0;
  --text-secondary: #aaaaaa;
  --bg-surface: #2a2a2a;
  --error-color: #f44336;
  --warning-color: #ffb74d;
  --accent-color: #90caf9;
  --accent-bg: #1e3a5f;
}

.app-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hamburger-icon {
  font-size: 1.25rem;
  line-height: 1;
}

.app-main {
  padding: 1rem;
  flex: 1;
}

.dimension-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.controls-sticky {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--bg-color);
  padding-bottom: 0.5rem;
}

.error {
  color: var(--error-color);
}

.warning {
  color: var(--warning-color);
  font-size: 0.875rem;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.drawer-section {
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.drawer-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

@media (max-width: 767px) {
  .app-header {
    padding: 0.5rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .app-header h1 {
    font-size: 1.125rem;
  }

  .app-main {
    padding: 0.5rem;
  }

  .header-controls {
    gap: 0.5rem;
  }
}
</style>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { NSelect, NButton } from 'naive-ui'
import type { Preset, PresetMapping, DimensionRole } from '../api/types'
import { apiClient } from '../api/client'

const props = defineProps<{
  /** Current dimension assignments as a Map of dimension name to role. */
  assignments: Map<string, DimensionRole>
  /** Names of all currently discovered dimensions. */
  dimensionNames: string[]
  /** Auto-load this preset ID if provided (used for restoring from localStorage). */
  autoLoadPresetId?: string | null
}>()

// load: Emitted when a preset is selected or auto-loaded. Payload: the loaded Preset and an array of missing dimension name warnings.
// save: Emitted after a new preset is successfully created. Payload: the newly created Preset.
// delete: Emitted after a preset is deleted, or when an auto-load preset is stale and not found. Payload: the preset ID string.
// new: Emitted when the user clicks New to start a fresh preset configuration. No payload.
const emit = defineEmits<{
  load: [preset: Preset, warnings: string[]]
  save: [preset: Preset]
  delete: [presetId: string]
  new: []
}>()

const presets = ref<Preset[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const attemptedAutoLoad = ref(false)

/**
 * Snapshot of assignments at the time a preset was loaded or saved.
 * Used for dirty tracking: if the current assignments differ from this snapshot,
 * the user has modified the preset configuration and Save should be enabled.
 * A null snapshot means no baseline has been established (initial state).
 */
const assignmentSnapshot = ref<Map<string, DimensionRole> | null>(null)

const selectOptions = computed(() =>
  presets.value.map((p) => ({
    label: p.name,
    value: p.id,
  }))
)

/**
 * Serialize assignments Map to a comparable string for dirty tracking.
 * Sorts entries by key to ensure deterministic comparison.
 */
function serializeAssignments(map: Map<string, DimensionRole>): string {
  const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  return JSON.stringify(entries)
}

/**
 * Whether the user has modified assignments since the last load, save, or new action.
 * True when the current assignments differ from the snapshot.
 */
const isDirty = computed(() => {
  if (assignmentSnapshot.value === null) return false
  return serializeAssignments(props.assignments) !== serializeAssignments(assignmentSnapshot.value)
})

/**
 * Take a snapshot of the current assignments for dirty tracking.
 * Called after load, save, and new actions to establish a clean baseline.
 */
function snapshotAssignments() {
  assignmentSnapshot.value = new Map(props.assignments)
}

/**
 * Watch for assignment changes propagated by the parent after a load event.
 * When a preset is loaded, the parent applies the mapping and the assignments prop
 * updates asynchronously. We need to re-snapshot once the parent has finished applying.
 * The pendingSnapshot flag coordinates this one-time update.
 */
const pendingSnapshot = ref(false)

watch(
  () => props.assignments,
  () => {
    if (pendingSnapshot.value) {
      pendingSnapshot.value = false
      snapshotAssignments()
    }
  },
  { deep: true }
)

onMounted(async () => {
  await fetchPresets()
  attemptAutoLoad()
})

/**
 * Auto-load a preset if autoLoadPresetId is provided and the preset exists.
 * Gracefully handles stale/deleted presets by clearing the selection.
 */
function attemptAutoLoad() {
  if (!props.autoLoadPresetId || attemptedAutoLoad.value) return
  attemptedAutoLoad.value = true

  const preset = presets.value.find((p) => p.id === props.autoLoadPresetId)
  if (preset) {
    // Preset exists, load it
    selectedId.value = preset.id
    const warnings = computeWarnings(preset)
    pendingSnapshot.value = true
    emit('load', preset, warnings)
  } else {
    // Preset no longer exists (stale), emit delete to clear localStorage
    emit('delete', props.autoLoadPresetId)
  }
}

async function fetchPresets() {
  loading.value = true
  error.value = null
  try {
    presets.value = await apiClient.getPresets()
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load presets'
    error.value = message
  } finally {
    loading.value = false
  }
}

function onSelect(value: string | null) {
  if (!value) {
    selectedId.value = null
    return
  }
  selectedId.value = value
  const preset = presets.value.find((p) => p.id === value)
  if (preset) {
    const warnings = computeWarnings(preset)
    pendingSnapshot.value = true
    emit('load', preset, warnings)
  }
}

/**
 * Handle the New button: clear the current preset selection and emit 'new'
 * so the parent can reset dimension assignments.
 */
function onNew() {
  selectedId.value = null
  assignmentSnapshot.value = null
  emit('new')
  // After the parent resets assignments, we snapshot the clean state on next tick.
  // Use pendingSnapshot so the watcher captures the reset.
  pendingSnapshot.value = true
}

function computeWarnings(preset: Preset): string[] {
  const warnings: string[] = []
  const allPresetDims = new Set<string>()
  if (preset.mapping.x) allPresetDims.add(preset.mapping.x)
  if (preset.mapping.y) allPresetDims.add(preset.mapping.y)
  if (preset.mapping.slider) allPresetDims.add(preset.mapping.slider)
  for (const c of preset.mapping.combos) allPresetDims.add(c)

  const currentDims = new Set(props.dimensionNames)
  for (const dim of allPresetDims) {
    if (!currentDims.has(dim)) {
      warnings.push(dim)
    }
  }
  return warnings
}

async function onSave() {
  const name = prompt('Preset name:')
  if (!name) return

  saving.value = true
  error.value = null
  try {
    const mapping = assignmentsToMapping()
    const preset = await apiClient.createPreset(name, mapping)
    presets.value.push(preset)
    selectedId.value = preset.id
    snapshotAssignments()
    emit('save', preset)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to save preset'
    error.value = message
  } finally {
    saving.value = false
  }
}

async function onDelete(id: string) {
  error.value = null
  try {
    await apiClient.deletePreset(id)
    presets.value = presets.value.filter((p) => p.id !== id)
    if (selectedId.value === id) {
      selectedId.value = null
      assignmentSnapshot.value = null
    }
    emit('delete', id)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to delete preset'
    error.value = message
  }
}

function assignmentsToMapping(): PresetMapping {
  const mapping: PresetMapping = { combos: [] }
  for (const [dim, role] of props.assignments) {
    switch (role) {
      case 'x':
        mapping.x = dim
        break
      case 'y':
        mapping.y = dim
        break
      case 'slider':
        mapping.slider = dim
        break
      case 'none':
        mapping.combos.push(dim)
        break
    }
  }
  return mapping
}
</script>

<template>
  <div class="preset-selector">
    <div class="preset-selector__top">
      <label for="preset-select">Preset</label>
      <NSelect
        :value="selectedId"
        :options="selectOptions"
        :disabled="loading"
        :placeholder="loading ? 'Loading...' : 'Select a preset'"
        :loading="loading"
        clearable
        class="preset-select"
        size="small"
        @update:value="onSelect"
      />
      <NButton
        size="small"
        aria-label="New preset"
        @click="onNew"
      >
        New
      </NButton>
    </div>
    <div class="preset-selector__actions">
      <NButton
        size="small"
        :disabled="saving || !isDirty"
        :loading="saving"
        aria-label="Save preset"
        @click="onSave"
      >
        {{ saving ? 'Saving...' : 'Save' }}
      </NButton>
      <NButton
        v-if="selectedId"
        size="small"
        type="error"
        aria-label="Delete preset"
        @click="onDelete(selectedId!)"
      >
        Delete
      </NButton>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.preset-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preset-selector__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.preset-selector__top label {
  font-weight: 600;
  white-space: nowrap;
}

.preset-select {
  min-width: 150px;
  flex: 1;
}

.preset-selector__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.error {
  color: var(--error-color);
  font-size: 0.875rem;
  margin: 0;
}
</style>

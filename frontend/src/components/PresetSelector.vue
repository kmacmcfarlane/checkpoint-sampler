<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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

const emit = defineEmits<{
  load: [preset: Preset, warnings: string[]]
  save: [preset: Preset]
  delete: [presetId: string]
}>()

const presets = ref<Preset[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const attemptedAutoLoad = ref(false)

const selectOptions = computed(() =>
  presets.value.map((p) => ({
    label: p.name,
    value: p.id,
  }))
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
    emit('load', preset, warnings)
  }
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
      :disabled="saving || assignments.size === 0"
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
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.preset-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.preset-selector label {
  font-weight: 600;
  white-space: nowrap;
}

.preset-select {
  min-width: 150px;
  flex: 1;
}

.error {
  color: var(--error-color, #d32f2f);
  font-size: 0.875rem;
  margin: 0;
}
</style>

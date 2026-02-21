<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Preset, PresetMapping, DimensionRole } from '../api/types'
import { apiClient } from '../api/client'

const props = defineProps<{
  /** Current dimension assignments as a Map of dimension name to role. */
  assignments: Map<string, DimensionRole>
  /** Names of all currently discovered dimensions. */
  dimensionNames: string[]
}>()

const emit = defineEmits<{
  load: [preset: Preset, warnings: string[]]
  save: [preset: Preset]
  delete: [presetId: string]
}>()

const presets = ref<Preset[]>([])
const selectedId = ref<string>('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  await fetchPresets()
})

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

function onSelect(event: Event) {
  const target = event.target as HTMLSelectElement
  const id = target.value
  if (!id) {
    selectedId.value = ''
    return
  }
  selectedId.value = id
  const preset = presets.value.find((p) => p.id === id)
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
      selectedId.value = ''
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
      case 'combo':
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
    <select
      id="preset-select"
      :value="selectedId"
      :disabled="loading"
      @change="onSelect"
    >
      <option value="">
        {{ loading ? 'Loading...' : 'Select a preset' }}
      </option>
      <option
        v-for="preset in presets"
        :key="preset.id"
        :value="preset.id"
      >
        {{ preset.name }}
      </option>
    </select>
    <button
      class="save-btn"
      :disabled="saving || assignments.size === 0"
      @click="onSave"
      aria-label="Save preset"
    >
      {{ saving ? 'Saving...' : 'Save' }}
    </button>
    <button
      v-if="selectedId"
      class="delete-btn"
      @click="onDelete(selectedId)"
      aria-label="Delete preset"
    >
      Delete
    </button>
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

.preset-selector select {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  min-width: 200px;
}

.save-btn,
.delete-btn {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
}

.save-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.delete-btn {
  color: #d32f2f;
  border-color: #d32f2f;
}

.delete-btn:hover {
  background: #fce4ec;
}

.error {
  color: #d32f2f;
  font-size: 0.875rem;
  margin: 0;
}
</style>

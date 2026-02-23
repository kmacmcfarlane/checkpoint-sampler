import { ref } from 'vue'

const STORAGE_KEY = 'checkpoint-sampler-last-preset'

export interface PresetPersistenceData {
  trainingRunId: number
  presetId: string
}

/**
 * Composable for persisting the last-used preset and training run to localStorage.
 *
 * - Saves preset ID and training run ID when a preset is loaded
 * - Restores the saved state on app load
 * - Clears the saved state when a preset is deleted or becomes invalid
 */
export function usePresetPersistence() {
  const savedData = ref<PresetPersistenceData | null>(getStoredData())

  function savePresetSelection(trainingRunId: number, presetId: string) {
    const data: PresetPersistenceData = { trainingRunId, presetId }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    savedData.value = data
  }

  function clearPresetSelection() {
    localStorage.removeItem(STORAGE_KEY)
    savedData.value = null
  }

  return {
    savedData,
    savePresetSelection,
    clearPresetSelection,
  }
}

function getStoredData(): PresetPersistenceData | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.trainingRunId === 'number' &&
      typeof parsed.presetId === 'string'
    ) {
      return parsed as PresetPersistenceData
    }
    return null
  } catch {
    return null
  }
}

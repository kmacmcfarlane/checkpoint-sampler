import { ref } from 'vue'

const STORAGE_KEY = 'checkpoint-sampler-last-preset'

/**
 * Internal storage format: a map of (trainingRunId|studyOutputDir) → presetId.
 * studyOutputDir may be empty string for runs without a study.
 */
interface PresetPersistenceStorage {
  presetsByKey: Record<string, string>
}

/**
 * Backward-compatible legacy format (single-entry, stored before per-combo migration).
 */
interface LegacyPresetPersistenceData {
  trainingRunId: number
  presetId: string
}

/**
 * Composable for persisting the last-used preset per training run + study combo to localStorage.
 *
 * - Saves preset ID keyed by training run ID + study output dir when a preset is loaded
 * - Retrieves the saved preset for a given TR+study combo
 * - Clears entries when a preset is deleted or becomes invalid
 * - Backward-compatible with the old single-entry format (migrates on first read)
 */
export function usePresetPersistence() {
  const storageData = ref<PresetPersistenceStorage>(getStoredData())

  /**
   * AC1: Save the selected preset ID for the given training run + study combo.
   */
  function savePresetSelection(trainingRunId: number, studyOutputDir: string, presetId: string) {
    const key = makeKey(trainingRunId, studyOutputDir)
    storageData.value.presetsByKey[key] = presetId
    persist(storageData.value)
  }

  /**
   * AC2: Get the stored preset ID for the given training run + study combo, or null if none.
   */
  function getPresetIdForCombo(trainingRunId: number, studyOutputDir: string): string | null {
    const key = makeKey(trainingRunId, studyOutputDir)
    return storageData.value.presetsByKey[key] ?? null
  }

  /**
   * Clear the preset selection for the given training run + study combo.
   * Removes the entire localStorage entry if no presets remain.
   */
  function clearPresetForCombo(trainingRunId: number, studyOutputDir: string) {
    const key = makeKey(trainingRunId, studyOutputDir)
    delete storageData.value.presetsByKey[key]
    if (Object.keys(storageData.value.presetsByKey).length === 0) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      persist(storageData.value)
    }
  }

  /**
   * Clear all stored preset selections (used when a preset is globally deleted).
   */
  function clearAllPresetSelections() {
    storageData.value.presetsByKey = {}
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    getPresetIdForCombo,
    savePresetSelection,
    clearPresetForCombo,
    clearAllPresetSelections,
  }
}

function makeKey(trainingRunId: number, studyOutputDir: string): string {
  return `${trainingRunId}|${studyOutputDir}`
}

function persist(data: PresetPersistenceStorage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function getStoredData(): PresetPersistenceStorage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { presetsByKey: {} }
    const parsed = JSON.parse(stored)

    // New format: { presetsByKey: Record<string, string> }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.presetsByKey === 'object' &&
      parsed.presetsByKey !== null
    ) {
      return parsed as PresetPersistenceStorage
    }

    // Legacy format: { trainingRunId: number, presetId: string }
    // Migrate: store the single entry under the legacy key (trainingRunId|"")
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.trainingRunId === 'number' &&
      typeof parsed.presetId === 'string'
    ) {
      const legacy = parsed as LegacyPresetPersistenceData
      const key = makeKey(legacy.trainingRunId, '')
      return { presetsByKey: { [key]: legacy.presetId } }
    }

    return { presetsByKey: {} }
  } catch {
    return { presetsByKey: {} }
  }
}

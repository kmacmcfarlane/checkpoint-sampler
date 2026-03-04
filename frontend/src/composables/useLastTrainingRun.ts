import { ref } from 'vue'

const STORAGE_KEY = 'checkpoint-sampler-last-training-run'

/**
 * Composable for persisting the last-used training run ID to localStorage,
 * independently of preset selection.
 *
 * This allows the app to restore the last-used training run on page load even
 * when no preset has been saved. The preset persistence composable only writes
 * when both a training run AND a preset are selected together.
 */
export function useLastTrainingRun() {
  const lastTrainingRunId = ref<number | null>(getStoredId())

  function saveLastTrainingRun(trainingRunId: number) {
    localStorage.setItem(STORAGE_KEY, String(trainingRunId))
    lastTrainingRunId.value = trainingRunId
  }

  function clearLastTrainingRun() {
    localStorage.removeItem(STORAGE_KEY)
    lastTrainingRunId.value = null
  }

  return {
    lastTrainingRunId,
    saveLastTrainingRun,
    clearLastTrainingRun,
  }
}

function getStoredId(): number | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = parseInt(stored, 10)
    if (!Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

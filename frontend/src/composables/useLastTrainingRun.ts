import { ref } from 'vue'

const STORAGE_KEY = 'checkpoint-sampler-last-training-run'

interface LastSelectionState {
  runId: number
  studiesByRunDir: Record<string, string>
}

/**
 * Composable for persisting the last-used training run ID and per-training-run
 * study selection to localStorage.
 *
 * Backward compatible: if localStorage contains a plain number (old format),
 * it is upgraded to the structured format on read.
 */
export function useLastTrainingRun() {
  const state = getStoredState()
  const lastTrainingRunId = ref<number | null>(state?.runId ?? null)

  function saveLastTrainingRun(trainingRunId: number) {
    const current = getStoredState() ?? { runId: trainingRunId, studiesByRunDir: {} }
    current.runId = trainingRunId
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    lastTrainingRunId.value = trainingRunId
  }

  function clearLastTrainingRun() {
    localStorage.removeItem(STORAGE_KEY)
    lastTrainingRunId.value = null
  }

  function saveLastStudy(trainingRunDir: string, studyOutputDir: string) {
    const current = getStoredState() ?? { runId: lastTrainingRunId.value ?? 0, studiesByRunDir: {} }
    current.studiesByRunDir[trainingRunDir] = studyOutputDir
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  }

  function getLastStudy(trainingRunDir: string): string | null {
    const current = getStoredState()
    if (!current) return null
    return current.studiesByRunDir[trainingRunDir] ?? null
  }

  return {
    lastTrainingRunId,
    saveLastTrainingRun,
    clearLastTrainingRun,
    saveLastStudy,
    getLastStudy,
  }
}

function getStoredState(): LastSelectionState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    // Try parsing as JSON first (new format)
    try {
      const parsed = JSON.parse(stored)
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.runId === 'number') {
        return parsed as LastSelectionState
      }
    } catch {
      // Not JSON — fall through to legacy parse
    }

    // Legacy: plain number
    const parsed = parseInt(stored, 10)
    if (!Number.isFinite(parsed)) return null
    return { runId: parsed, studiesByRunDir: {} }
  } catch {
    return null
  }
}

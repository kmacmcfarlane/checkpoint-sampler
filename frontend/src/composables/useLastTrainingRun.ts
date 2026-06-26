import { ref } from 'vue'

const STORAGE_KEY = 'checkpoint-sampler-last-training-run'

interface LastSelectionState {
  runId: string
  studiesByRunDir: Record<string, string>
}

/**
 * Composable for persisting the last-used training run ID and per-training-run
 * study selection to localStorage.
 *
 * S-155: training-run ids are now stable opaque strings. Any legacy stored
 * value (a plain number or a numeric runId) is treated as invalid and ignored
 * on read, so stale positional ids never resolve to the wrong run.
 */
export function useLastTrainingRun() {
  const state = getStoredState()
  const lastTrainingRunId = ref<string | null>(state?.runId ?? null)

  function saveLastTrainingRun(trainingRunId: string) {
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
    const current = getStoredState() ?? { runId: lastTrainingRunId.value ?? '', studiesByRunDir: {} }
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

    // Parse as JSON (current format). S-155: runId must be a string. Legacy
    // numeric runIds (positional indices) and legacy plain-number storage are
    // intentionally discarded so a stale id can never select the wrong run.
    try {
      const parsed = JSON.parse(stored)
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.runId === 'string') {
        const studies =
          typeof parsed.studiesByRunDir === 'object' && parsed.studiesByRunDir !== null
            ? (parsed.studiesByRunDir as Record<string, string>)
            : {}
        return { runId: parsed.runId, studiesByRunDir: studies }
      }
    } catch {
      // Not JSON — fall through to discard.
    }

    return null
  } catch {
    return null
  }
}

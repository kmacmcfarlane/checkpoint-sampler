/**
 * Composable for persisting Generate Samples dialog inputs to localStorage.
 *
 * Storage key: 'checkpoint-sampler:generate-inputs'
 *
 * Shape:
 *   {
 *     lastWorkflowId: string | null,
 *     lastTrainingRunId: number | null,
 *     byModelType: {
 *       [modelType: string]: { vae: string | null, clip: string | null, shift: number | null }
 *     }
 *   }
 *
 * The modelType key is ss_base_model_version from the first checkpoint's safetensors
 * metadata. When a value is no longer available (e.g. a deleted VAE), the caller is
 * responsible for falling back to null/empty.
 */

export const GENERATE_INPUTS_STORAGE_KEY = 'checkpoint-sampler:generate-inputs'

/** Per-model-type persisted inputs. */
export interface PersistedModelInputs {
  vae: string | null
  clip: string | null
  shift: number | null
}

/** Full shape of the persisted generate-inputs state. */
export interface GenerateInputsState {
  lastWorkflowId: string | null
  lastTrainingRunId?: number | null
  byModelType: Record<string, PersistedModelInputs>
}

/** Returns the currently stored state, or a fresh default if missing/corrupt. */
function loadState(): GenerateInputsState {
  try {
    const raw = localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed: unknown = JSON.parse(raw)
    if (!isValidState(parsed)) return defaultState()
    return parsed
  } catch {
    return defaultState()
  }
}

function defaultState(): GenerateInputsState {
  return { lastWorkflowId: null, lastTrainingRunId: null, byModelType: {} }
}

function isValidState(v: unknown): v is GenerateInputsState {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!('lastWorkflowId' in obj)) return false
  if (obj.lastWorkflowId !== null && typeof obj.lastWorkflowId !== 'string') return false
  // lastTrainingRunId is optional (backward-compatible); if present it must be number or null
  if ('lastTrainingRunId' in obj && obj.lastTrainingRunId !== null && obj.lastTrainingRunId !== undefined && typeof obj.lastTrainingRunId !== 'number') return false
  if (typeof obj.byModelType !== 'object' || obj.byModelType === null) return false
  for (const entry of Object.values(obj.byModelType as Record<string, unknown>)) {
    if (!isValidModelInputs(entry)) return false
  }
  return true
}

function isValidModelInputs(v: unknown): v is PersistedModelInputs {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!('vae' in obj) || !('clip' in obj) || !('shift' in obj)) return false
  if (obj.vae !== null && typeof obj.vae !== 'string') return false
  if (obj.clip !== null && typeof obj.clip !== 'string') return false
  if (obj.shift !== null && typeof obj.shift !== 'number') return false
  return true
}

function saveState(state: GenerateInputsState): void {
  try {
    localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage unavailable (private browsing quota exceeded, etc.) — fail silently
  }
}

/**
 * Composable providing read/write access to the persisted Generate Samples inputs.
 */
export function useGenerateInputsPersistence() {
  /** Load the last remembered workflow ID. */
  function getLastWorkflowId(): string | null {
    return loadState().lastWorkflowId
  }

  /** Persist the selected workflow ID. Pass null to clear it. */
  function saveWorkflowId(workflowId: string | null): void {
    const state = loadState()
    state.lastWorkflowId = workflowId
    saveState(state)
  }

  /** Load the last remembered training run ID. */
  function getLastTrainingRunId(): number | null {
    return loadState().lastTrainingRunId ?? null
  }

  /** Persist the selected training run ID. Pass null to clear it. */
  function saveTrainingRunId(trainingRunId: number | null): void {
    const state = loadState()
    state.lastTrainingRunId = trainingRunId
    saveState(state)
  }

  /** Load the remembered model-type-specific inputs for a given model type key. */
  function getModelInputs(modelType: string): PersistedModelInputs | null {
    const state = loadState()
    return state.byModelType[modelType] ?? null
  }

  /** Persist model-type-specific inputs keyed by model type. */
  function saveModelInputs(modelType: string, inputs: PersistedModelInputs): void {
    const state = loadState()
    state.byModelType[modelType] = inputs
    saveState(state)
  }

  return {
    getLastWorkflowId,
    saveWorkflowId,
    getLastTrainingRunId,
    saveTrainingRunId,
    getModelInputs,
    saveModelInputs,
  }
}

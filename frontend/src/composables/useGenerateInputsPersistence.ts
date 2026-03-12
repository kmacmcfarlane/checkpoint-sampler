/**
 * Composable for persisting Generate Samples dialog inputs to localStorage.
 *
 * Storage key: 'checkpoint-sampler:generate-inputs'
 *
 * Shape:
 *   {
 *     lastWorkflowId: string | null,      — global fallback; superseded by byModelType[t].workflowId when present
 *     lastTrainingRunId: number | null,
 *     lastStudyId: string | null,
 *     hasSamplesFilter: boolean | null,   — optional; null means "not set" (defaults to true in UI)
 *     byModelType: {
 *       [modelType: string]: {
 *         vae: string | null,
 *         clip: string | null,
 *         shift: number | null,
 *         workflowId: string | null,      — per-model-type workflow preference (AC3)
 *       }
 *     }
 *     modelTypeByRunId: {
 *       [runId: string]: string           — cached model type (ss_base_model_version) per training run ID
 *     }
 *   }
 *
 * The modelType key is ss_base_model_version from the first checkpoint's safetensors
 * metadata. When a value is no longer available (e.g. a deleted VAE), the caller is
 * responsible for falling back to null/empty.
 *
 * modelTypeByRunId caches the resolved model type per training run so that the
 * per-model-type workflow preference can be applied immediately on the next session
 * without waiting for an async metadata fetch (S-119).
 */

export const GENERATE_INPUTS_STORAGE_KEY = 'checkpoint-sampler:generate-inputs'

/** Per-model-type persisted inputs. */
export interface PersistedModelInputs {
  vae: string | null
  clip: string | null
  shift: number | null
  /** Per-model-type workflow preference (AC3). Optional for backward compatibility. */
  workflowId?: string | null
}

/** Full shape of the persisted generate-inputs state. */
export interface GenerateInputsState {
  lastWorkflowId: string | null
  lastTrainingRunId?: number | null
  lastStudyId?: string | null
  /**
   * Has-samples filter preference for TrainingRunSelector (AC1).
   * true = show only runs with samples (default behaviour).
   * false = show all runs.
   * null / absent = not set; UI defaults to true.
   */
  hasSamplesFilter?: boolean | null
  byModelType: Record<string, PersistedModelInputs>
  /**
   * Cached model type (ss_base_model_version) keyed by training run ID (as string).
   * Allows per-model-type workflow preferences to be applied speculatively on the next
   * session without waiting for an async metadata fetch (S-119).
   * Optional for backward compatibility.
   */
  modelTypeByRunId?: Record<string, string>
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
  return { lastWorkflowId: null, lastTrainingRunId: null, lastStudyId: null, hasSamplesFilter: null, byModelType: {} }
}

function isValidState(v: unknown): v is GenerateInputsState {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!('lastWorkflowId' in obj)) return false
  if (obj.lastWorkflowId !== null && typeof obj.lastWorkflowId !== 'string') return false
  // lastTrainingRunId is optional (backward-compatible); if present it must be number or null
  if ('lastTrainingRunId' in obj && obj.lastTrainingRunId !== null && obj.lastTrainingRunId !== undefined && typeof obj.lastTrainingRunId !== 'number') return false
  // lastStudyId is optional (backward-compatible); if present it must be string or null
  if ('lastStudyId' in obj && obj.lastStudyId !== null && obj.lastStudyId !== undefined && typeof obj.lastStudyId !== 'string') return false
  // hasSamplesFilter is optional (backward-compatible); if present it must be boolean or null
  if ('hasSamplesFilter' in obj && obj.hasSamplesFilter !== null && obj.hasSamplesFilter !== undefined && typeof obj.hasSamplesFilter !== 'boolean') return false
  if (typeof obj.byModelType !== 'object' || obj.byModelType === null) return false
  for (const entry of Object.values(obj.byModelType as Record<string, unknown>)) {
    if (!isValidModelInputs(entry)) return false
  }
  // modelTypeByRunId is optional (backward-compatible); if present it must be a string→string map
  if ('modelTypeByRunId' in obj && obj.modelTypeByRunId !== null && obj.modelTypeByRunId !== undefined) {
    if (typeof obj.modelTypeByRunId !== 'object') return false
    for (const val of Object.values(obj.modelTypeByRunId as Record<string, unknown>)) {
      if (typeof val !== 'string') return false
    }
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
  // workflowId is optional (backward-compatible); if present it must be string or null
  if ('workflowId' in obj && obj.workflowId !== null && obj.workflowId !== undefined && typeof obj.workflowId !== 'string') return false
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

  /** Load the last remembered study ID. */
  function getLastStudyId(): string | null {
    return loadState().lastStudyId ?? null
  }

  /** Persist the selected study ID. Pass null to clear it. */
  function saveStudyId(studyId: string | null): void {
    const state = loadState()
    state.lastStudyId = studyId
    saveState(state)
  }

  /**
   * Load the has-samples filter preference (AC1).
   * Returns null when not set (caller should default to true).
   */
  function getHasSamplesFilter(): boolean | null {
    const state = loadState()
    return state.hasSamplesFilter ?? null
  }

  /**
   * Persist the has-samples filter preference (AC1).
   * Pass null to clear it (revert to default behaviour).
   */
  function saveHasSamplesFilter(value: boolean | null): void {
    const state = loadState()
    state.hasSamplesFilter = value
    saveState(state)
  }

  /** Load the remembered model-type-specific inputs for a given model type key. */
  function getModelInputs(modelType: string): PersistedModelInputs | null {
    const state = loadState()
    return state.byModelType[modelType] ?? null
  }

  /** Persist model-type-specific inputs keyed by model type.
   * Merges into the existing entry so that fields not included in `inputs`
   * (e.g. workflowId saved by a separate call) are preserved.
   */
  function saveModelInputs(modelType: string, inputs: PersistedModelInputs): void {
    const state = loadState()
    state.byModelType[modelType] = { ...state.byModelType[modelType], ...inputs }
    saveState(state)
  }

  /**
   * Load the per-model-type workflow preference (AC3).
   * Returns null when not set for the given model type.
   */
  function getWorkflowIdForModelType(modelType: string): string | null {
    const state = loadState()
    return state.byModelType[modelType]?.workflowId ?? null
  }

  /**
   * Persist the workflow preference for a specific model type (AC3).
   * Pass null to clear it for that model type.
   */
  function saveWorkflowIdForModelType(modelType: string, workflowId: string | null): void {
    const state = loadState()
    if (!state.byModelType[modelType]) {
      state.byModelType[modelType] = { vae: null, clip: null, shift: null, workflowId }
    } else {
      state.byModelType[modelType] = { ...state.byModelType[modelType], workflowId }
    }
    saveState(state)
  }

  /**
   * Retrieve the cached model type for a training run (S-119).
   * Returns null when not cached (metadata fetch is required).
   */
  function getModelTypeForRun(runId: number): string | null {
    const state = loadState()
    return state.modelTypeByRunId?.[String(runId)] ?? null
  }

  /**
   * Cache the model type for a training run (S-119).
   * Called after a successful metadata fetch so that subsequent sessions can
   * apply the per-model-type workflow preference without an extra round-trip.
   */
  function saveModelTypeForRun(runId: number, modelType: string): void {
    const state = loadState()
    if (!state.modelTypeByRunId) {
      state.modelTypeByRunId = {}
    }
    state.modelTypeByRunId[String(runId)] = modelType
    saveState(state)
  }

  return {
    getLastWorkflowId,
    saveWorkflowId,
    getLastTrainingRunId,
    saveTrainingRunId,
    getLastStudyId,
    saveStudyId,
    getHasSamplesFilter,
    saveHasSamplesFilter,
    getModelInputs,
    saveModelInputs,
    getWorkflowIdForModelType,
    saveWorkflowIdForModelType,
    getModelTypeForRun,
    saveModelTypeForRun,
  }
}

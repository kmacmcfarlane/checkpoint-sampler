/**
 * Most-recently-used (MRU) persistence for the Study Editor.
 *
 * Extracted verbatim from StudyEditor.vue (R-021). Every accessor swallows
 * localStorage errors and returns a safe empty value, so a disabled or full
 * quota storage degrades to "no MRU" rather than breaking the editor.
 */

/** localStorage key for the most-recently-used workflow template. */
export const MRU_WORKFLOW_KEY = 'checkpoint-sampler:mru-workflow-template'

/**
 * localStorage key for most-recently-used VAE, text encoder, and shift per workflow template.
 * S-157: these are now multi-value dimensions, stored as arrays. Reads tolerate the
 * legacy single-value shape ({ vae, textEncoder, shift }) by wrapping in arrays.
 * Stored as a JSON-serialised map:
 *   Record<workflowName, { vaes: string[], textEncoders: string[], shifts: number[] }>.
 */
export const MRU_WORKFLOW_VAE_TE_KEY = 'checkpoint-sampler:mru-workflow-vae-te'

/**
 * localStorage key for most-recently-used sampler/scheduler pairs per workflow template.
 * Stored as a JSON-serialised map: Record<workflowName, Array<{ sampler: string, scheduler: string }>>.
 */
export const MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY = 'checkpoint-sampler:mru-workflow-sampler-scheduler'

/** Multi-value MRU shape for VAE / text-encoder / shift dimensions (S-157). */
export interface MruDimensions {
  vaes: string[]
  textEncoders: string[]
  shifts: number[]
}

export function getMruWorkflow(): string | null {
  try { return localStorage.getItem(MRU_WORKFLOW_KEY) } catch { return null }
}

export function saveMruWorkflow(name: string | null): void {
  try {
    if (name) localStorage.setItem(MRU_WORKFLOW_KEY, name)
    else localStorage.removeItem(MRU_WORKFLOW_KEY)
  } catch { /* ignore */ }
}

/** Returns the raw MRU VAE/text-encoder/shift map from localStorage. */
export function getMruVaeTe(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(MRU_WORKFLOW_VAE_TE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
    return {}
  } catch { return {} }
}

/**
 * Normalizes a stored MRU entry into the multi-value shape, tolerating the legacy
 * single-value shape ({ vae, textEncoder, shift }) written before S-157.
 */
export function normalizeMruEntry(entry: unknown): MruDimensions | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (Array.isArray(e.vaes) || Array.isArray(e.textEncoders) || Array.isArray(e.shifts)) {
    return {
      vaes: Array.isArray(e.vaes) ? (e.vaes as string[]) : [],
      textEncoders: Array.isArray(e.textEncoders) ? (e.textEncoders as string[]) : [],
      shifts: Array.isArray(e.shifts) ? (e.shifts as number[]) : [],
    }
  }
  // Legacy single-value shape.
  return {
    vaes: typeof e.vae === 'string' && e.vae ? [e.vae] : [],
    textEncoders: typeof e.textEncoder === 'string' && e.textEncoder ? [e.textEncoder] : [],
    shifts: typeof e.shift === 'number' ? [e.shift] : [],
  }
}

/** Returns the MRU dimensions for a given workflow name, or null if not stored. */
export function getMruVaeTeForWorkflow(workflowName: string): MruDimensions | null {
  const map = getMruVaeTe()
  return normalizeMruEntry(map[workflowName])
}

/** Saves the MRU VAE, text encoder, and shift lists for a given workflow name (S-157). */
export function saveMruVaeTe(workflowName: string, vaes: string[], textEncoders: string[], shifts: number[]): void {
  try {
    const map = getMruVaeTe()
    map[workflowName] = { vaes, textEncoders, shifts }
    localStorage.setItem(MRU_WORKFLOW_VAE_TE_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

/** Returns the MRU sampler/scheduler pairs map from localStorage. */
export function getMruSamplerScheduler(): Record<string, Array<{ sampler: string; scheduler: string }>> {
  try {
    const raw = localStorage.getItem(MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, Array<{ sampler: string; scheduler: string }>>
    return {}
  } catch { return {} }
}

/** Returns the MRU sampler/scheduler pairs for a given workflow name, or null if not stored. */
export function getMruSamplerSchedulerForWorkflow(workflowName: string): Array<{ sampler: string; scheduler: string }> | null {
  const map = getMruSamplerScheduler()
  return map[workflowName] ?? null
}

/** Saves the MRU sampler/scheduler pairs for a given workflow name. */
export function saveMruSamplerScheduler(workflowName: string, pairs: Array<{ sampler: string; scheduler: string }>): void {
  try {
    const map = getMruSamplerScheduler()
    map[workflowName] = pairs
    localStorage.setItem(MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

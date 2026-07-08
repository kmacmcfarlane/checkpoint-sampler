import type { CreateStudyPayload, NamedPrompt, SamplerSchedulerPair, LoraStrengthPair, ResolutionPair } from '../api/types'

/**
 * Result of validating a study import JSON payload.
 * On success, returns the validated CreateStudyPayload.
 * On failure, returns an error message string.
 */
export type StudyImportResult =
  | { ok: true; data: CreateStudyPayload }
  | { ok: false; error: string }

/**
 * Validates a parsed JSON object as a study import payload.
 * Checks required fields, types, and constraints.
 * Returns either the validated data (with optional fields defaulted) or an error message.
 */
export function validateStudyImport(raw: unknown): StudyImportResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Invalid JSON: expected an object' }
  }

  const obj = raw as Record<string, unknown>

  // Validate name
  if (!('name' in obj) || typeof obj.name !== 'string' || obj.name.trim() === '') {
    return { ok: false, error: 'Missing or invalid field: "name" must be a non-empty string' }
  }

  // Validate prompts
  if (!('prompts' in obj) || !Array.isArray(obj.prompts)) {
    return { ok: false, error: 'Missing or invalid field: "prompts" must be an array' }
  }
  if (obj.prompts.length === 0) {
    return { ok: false, error: 'Invalid field: "prompts" must have at least one entry' }
  }
  for (let i = 0; i < obj.prompts.length; i++) {
    const p = obj.prompts[i]
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, error: `Invalid field: "prompts[${i}]" must be an object` }
    }
    const prompt = p as Record<string, unknown>
    if (typeof prompt.name !== 'string') {
      return { ok: false, error: `Invalid field: "prompts[${i}].name" must be a string` }
    }
    if (typeof prompt.text !== 'string') {
      return { ok: false, error: `Invalid field: "prompts[${i}].text" must be a string` }
    }
  }

  // Validate steps
  if (!('steps' in obj) || !Array.isArray(obj.steps)) {
    return { ok: false, error: 'Missing or invalid field: "steps" must be an array' }
  }
  if (obj.steps.length === 0) {
    return { ok: false, error: 'Invalid field: "steps" must have at least one entry' }
  }
  for (let i = 0; i < obj.steps.length; i++) {
    const v = obj.steps[i]
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
      return { ok: false, error: `Invalid field: "steps[${i}]" must be a positive integer` }
    }
  }

  // Validate cfgs
  if (!('cfgs' in obj) || !Array.isArray(obj.cfgs)) {
    return { ok: false, error: 'Missing or invalid field: "cfgs" must be an array' }
  }
  if (obj.cfgs.length === 0) {
    return { ok: false, error: 'Invalid field: "cfgs" must have at least one entry' }
  }
  for (let i = 0; i < obj.cfgs.length; i++) {
    const v = obj.cfgs[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `Invalid field: "cfgs[${i}]" must be a finite number` }
    }
  }

  // Validate sampler_scheduler_pairs
  if (!('sampler_scheduler_pairs' in obj) || !Array.isArray(obj.sampler_scheduler_pairs)) {
    return { ok: false, error: 'Missing or invalid field: "sampler_scheduler_pairs" must be an array' }
  }
  if (obj.sampler_scheduler_pairs.length === 0) {
    return { ok: false, error: 'Invalid field: "sampler_scheduler_pairs" must have at least one entry' }
  }
  for (let i = 0; i < obj.sampler_scheduler_pairs.length; i++) {
    const pair = obj.sampler_scheduler_pairs[i]
    if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) {
      return { ok: false, error: `Invalid field: "sampler_scheduler_pairs[${i}]" must be an object` }
    }
    const pairObj = pair as Record<string, unknown>
    if (typeof pairObj.sampler !== 'string') {
      return { ok: false, error: `Invalid field: "sampler_scheduler_pairs[${i}].sampler" must be a string` }
    }
    if (typeof pairObj.scheduler !== 'string') {
      return { ok: false, error: `Invalid field: "sampler_scheduler_pairs[${i}].scheduler" must be a string` }
    }
  }

  // Validate seeds
  if (!('seeds' in obj) || !Array.isArray(obj.seeds)) {
    return { ok: false, error: 'Missing or invalid field: "seeds" must be an array' }
  }
  if (obj.seeds.length === 0) {
    return { ok: false, error: 'Invalid field: "seeds" must have at least one entry' }
  }
  for (let i = 0; i < obj.seeds.length; i++) {
    const v = obj.seeds[i]
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      return { ok: false, error: `Invalid field: "seeds[${i}]" must be a non-negative integer` }
    }
  }

  // Validate resolutions (S-157). New exports carry a "resolutions" list; legacy
  // exports carry scalar "width"/"height", which are accepted and wrapped into a
  // single-element list for backward compatibility.
  let resolutions: ResolutionPair[]
  if ('resolutions' in obj && obj.resolutions !== undefined && obj.resolutions !== null) {
    if (!Array.isArray(obj.resolutions) || obj.resolutions.length === 0) {
      return { ok: false, error: 'Invalid field: "resolutions" must be a non-empty array' }
    }
    const parsed: ResolutionPair[] = []
    for (let i = 0; i < obj.resolutions.length; i++) {
      const r = obj.resolutions[i]
      if (r === null || typeof r !== 'object' || Array.isArray(r)) {
        return { ok: false, error: `Invalid field: "resolutions[${i}]" must be an object` }
      }
      const rObj = r as Record<string, unknown>
      if (typeof rObj.width !== 'number' || !Number.isFinite(rObj.width) || rObj.width <= 0) {
        return { ok: false, error: `Invalid field: "resolutions[${i}].width" must be a positive number` }
      }
      if (typeof rObj.height !== 'number' || !Number.isFinite(rObj.height) || rObj.height <= 0) {
        return { ok: false, error: `Invalid field: "resolutions[${i}].height" must be a positive number` }
      }
      parsed.push({ width: rObj.width, height: rObj.height })
    }
    resolutions = parsed
  } else {
    // Legacy scalar width/height.
    if (!('width' in obj) || typeof obj.width !== 'number' || !Number.isFinite(obj.width) || obj.width <= 0) {
      return { ok: false, error: 'Missing or invalid field: "resolutions" (or legacy "width") must be provided' }
    }
    if (!('height' in obj) || typeof obj.height !== 'number' || !Number.isFinite(obj.height) || obj.height <= 0) {
      return { ok: false, error: 'Missing or invalid field: "resolutions" (or legacy "height") must be provided' }
    }
    resolutions = [{ width: obj.width, height: obj.height }]
  }

  // Validate S-157 list dimensions (optional; legacy scalar fallbacks accepted).
  const vaes = parseStringDimension(obj, 'vaes', 'vae')
  if (typeof vaes === 'string') return { ok: false, error: vaes }
  const textEncoders = parseStringDimension(obj, 'text_encoders', 'text_encoder')
  if (typeof textEncoders === 'string') return { ok: false, error: textEncoders }
  const shifts = parseNumberDimension(obj, 'shifts', 'shift')
  if (typeof shifts === 'string') return { ok: false, error: shifts }

  // Validate lora_strength_pairs (optional)
  let loraStrengthPairs: LoraStrengthPair[] | undefined
  if ('lora_strength_pairs' in obj && obj.lora_strength_pairs !== undefined && obj.lora_strength_pairs !== null) {
    if (!Array.isArray(obj.lora_strength_pairs)) {
      return { ok: false, error: 'Invalid field: "lora_strength_pairs" must be an array' }
    }
    for (let i = 0; i < obj.lora_strength_pairs.length; i++) {
      const pair = obj.lora_strength_pairs[i]
      if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) {
        return { ok: false, error: `Invalid field: "lora_strength_pairs[${i}]" must be an object` }
      }
      const pairObj = pair as Record<string, unknown>
      if (typeof pairObj.strength_model !== 'number' || !Number.isFinite(pairObj.strength_model)) {
        return { ok: false, error: `Invalid field: "lora_strength_pairs[${i}].strength_model" must be a finite number` }
      }
      if (typeof pairObj.strength_clip !== 'number' || !Number.isFinite(pairObj.strength_clip)) {
        return { ok: false, error: `Invalid field: "lora_strength_pairs[${i}].strength_clip" must be a finite number` }
      }
    }
    loraStrengthPairs = obj.lora_strength_pairs as LoraStrengthPair[]
  }

  // Optional fields with defaults
  const promptPrefix = typeof obj.prompt_prefix === 'string' ? obj.prompt_prefix : ''
  const negativePrompt = typeof obj.negative_prompt === 'string' ? obj.negative_prompt : ''

  return {
    ok: true,
    data: {
      name: (obj.name as string).trim(),
      prompt_prefix: promptPrefix,
      prompts: obj.prompts as NamedPrompt[],
      negative_prompt: negativePrompt,
      steps: obj.steps as number[],
      cfgs: obj.cfgs as number[],
      sampler_scheduler_pairs: obj.sampler_scheduler_pairs as SamplerSchedulerPair[],
      seeds: obj.seeds as number[],
      resolutions,
      workflow_template: typeof obj.workflow_template === 'string' ? obj.workflow_template : undefined,
      vaes,
      text_encoders: textEncoders,
      shifts,
      lora_strength_pairs: loraStrengthPairs,
    },
  }
}

/**
 * Parses a string-valued multi-value dimension from the import object.
 * Accepts a `listKey` array or falls back to a legacy scalar `scalarKey` string.
 * Returns the parsed array, or an error message string on invalid input.
 */
function parseStringDimension(obj: Record<string, unknown>, listKey: string, scalarKey: string): string[] | string {
  if (listKey in obj && obj[listKey] !== undefined && obj[listKey] !== null) {
    const raw = obj[listKey]
    if (!Array.isArray(raw)) return `Invalid field: "${listKey}" must be an array`
    for (let i = 0; i < raw.length; i++) {
      if (typeof raw[i] !== 'string' || raw[i] === '') {
        return `Invalid field: "${listKey}[${i}]" must be a non-empty string`
      }
    }
    return raw as string[]
  }
  if (typeof obj[scalarKey] === 'string' && obj[scalarKey] !== '') {
    return [obj[scalarKey] as string]
  }
  return []
}

/**
 * Parses a number-valued multi-value dimension from the import object.
 * Accepts a `listKey` array or falls back to a legacy scalar `scalarKey` number.
 * Returns the parsed array, or an error message string on invalid input.
 */
function parseNumberDimension(obj: Record<string, unknown>, listKey: string, scalarKey: string): number[] | string {
  if (listKey in obj && obj[listKey] !== undefined && obj[listKey] !== null) {
    const raw = obj[listKey]
    if (!Array.isArray(raw)) return `Invalid field: "${listKey}" must be an array`
    for (let i = 0; i < raw.length; i++) {
      if (typeof raw[i] !== 'number' || !Number.isFinite(raw[i])) {
        return `Invalid field: "${listKey}[${i}]" must be a finite number`
      }
    }
    return raw as number[]
  }
  if (typeof obj[scalarKey] === 'number' && Number.isFinite(obj[scalarKey])) {
    return [obj[scalarKey] as number]
  }
  return []
}

import type { CreateStudyPayload, NamedPrompt, SamplerSchedulerPair } from '../api/types'

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

  // Validate width
  if (!('width' in obj) || typeof obj.width !== 'number' || !Number.isFinite(obj.width)) {
    return { ok: false, error: 'Missing or invalid field: "width" must be a number' }
  }
  if (obj.width <= 0) {
    return { ok: false, error: 'Invalid field: "width" must be a positive number' }
  }

  // Validate height
  if (!('height' in obj) || typeof obj.height !== 'number' || !Number.isFinite(obj.height)) {
    return { ok: false, error: 'Missing or invalid field: "height" must be a number' }
  }
  if (obj.height <= 0) {
    return { ok: false, error: 'Invalid field: "height" must be a positive number' }
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
      width: obj.width as number,
      height: obj.height as number,
      workflow_template: typeof obj.workflow_template === 'string' ? obj.workflow_template : undefined,
      vae: typeof obj.vae === 'string' ? obj.vae : undefined,
      text_encoder: typeof obj.text_encoder === 'string' ? obj.text_encoder : undefined,
      shift: typeof obj.shift === 'number' && Number.isFinite(obj.shift) ? obj.shift : undefined,
    },
  }
}

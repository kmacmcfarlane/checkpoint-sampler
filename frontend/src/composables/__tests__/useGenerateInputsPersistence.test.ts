import { describe, it, expect, beforeEach } from 'vitest'
import {
  useGenerateInputsPersistence,
  GENERATE_INPUTS_STORAGE_KEY,
  type GenerateInputsState,
} from '../useGenerateInputsPersistence'

describe('useGenerateInputsPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ── getLastWorkflowId ──────────────────────────────────────────────────────

  describe('getLastWorkflowId', () => {
    it('returns null when storage is empty', () => {
      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
    })

    it('returns the stored workflow ID', () => {
      const state: GenerateInputsState = { lastWorkflowId: 'qwen-image.json', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBe('qwen-image.json')
    })

    it('returns null when stored value is invalid JSON', () => {
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, 'not-json')
      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
    })

    it('returns null when stored object is missing lastWorkflowId', () => {
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify({ byModelType: {} }))
      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
    })

    it('returns null when lastWorkflowId is not a string or null', () => {
      localStorage.setItem(
        GENERATE_INPUTS_STORAGE_KEY,
        JSON.stringify({ lastWorkflowId: 42, byModelType: {} })
      )
      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
    })

    it('returns null when stored lastWorkflowId is null', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getLastWorkflowId } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
    })
  })

  // ── saveWorkflowId ─────────────────────────────────────────────────────────

  describe('saveWorkflowId', () => {
    it('saves a workflow ID to localStorage', () => {
      const { saveWorkflowId, getLastWorkflowId } = useGenerateInputsPersistence()
      saveWorkflowId('auraflow-image.json')
      expect(getLastWorkflowId()).toBe('auraflow-image.json')
    })

    it('saves null as the workflow ID', () => {
      const { saveWorkflowId, getLastWorkflowId } = useGenerateInputsPersistence()
      saveWorkflowId('qwen-image.json')
      saveWorkflowId(null)
      expect(getLastWorkflowId()).toBeNull()
    })

    it('overwrites a previous workflow ID', () => {
      const { saveWorkflowId, getLastWorkflowId } = useGenerateInputsPersistence()
      saveWorkflowId('qwen-image.json')
      saveWorkflowId('auraflow-image.json')
      expect(getLastWorkflowId()).toBe('auraflow-image.json')
    })

    it('preserves byModelType entries when saving a workflow ID', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveWorkflowId, getModelInputs } = useGenerateInputsPersistence()
      saveWorkflowId('qwen-image.json')

      const inputs = getModelInputs('qwen_image')
      expect(inputs).toEqual({ vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })
    })
  })

  // ── getModelInputs ─────────────────────────────────────────────────────────

  describe('getModelInputs', () => {
    it('returns null when no entry exists for the given model type', () => {
      const { getModelInputs } = useGenerateInputsPersistence()
      expect(getModelInputs('qwen_image')).toBeNull()
    })

    it('returns the stored inputs for a model type', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getModelInputs } = useGenerateInputsPersistence()
      expect(getModelInputs('qwen_image')).toEqual({
        vae: 'ae.safetensors',
        clip: 'clip_l.safetensors',
        shift: null,
      })
    })

    it('returns inputs including a shift value', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          aura_flow: { vae: 'ae.safetensors', clip: 't5xxl_fp16.safetensors', shift: 3.5 },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getModelInputs } = useGenerateInputsPersistence()
      expect(getModelInputs('aura_flow')).toEqual({
        vae: 'ae.safetensors',
        clip: 't5xxl_fp16.safetensors',
        shift: 3.5,
      })
    })

    it('returns null when the stored state is corrupt', () => {
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, 'bad-data')
      const { getModelInputs } = useGenerateInputsPersistence()
      expect(getModelInputs('qwen_image')).toBeNull()
    })
  })

  // ── saveModelInputs ────────────────────────────────────────────────────────

  describe('saveModelInputs', () => {
    it('saves model-type-specific inputs to localStorage', () => {
      const { saveModelInputs, getModelInputs } = useGenerateInputsPersistence()
      saveModelInputs('qwen_image', { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })
      expect(getModelInputs('qwen_image')).toEqual({
        vae: 'ae.safetensors',
        clip: 'clip_l.safetensors',
        shift: null,
      })
    })

    it('saves model inputs with a shift value', () => {
      const { saveModelInputs, getModelInputs } = useGenerateInputsPersistence()
      saveModelInputs('aura_flow', { vae: 'ae.safetensors', clip: 't5xxl_fp16.safetensors', shift: 2.5 })
      expect(getModelInputs('aura_flow')?.shift).toBe(2.5)
    })

    it('saves entries for multiple model types independently', () => {
      const { saveModelInputs, getModelInputs } = useGenerateInputsPersistence()
      saveModelInputs('qwen_image', { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })
      saveModelInputs('aura_flow', { vae: 'vae-ft.safetensors', clip: 't5xxl_fp16.safetensors', shift: 3.0 })

      expect(getModelInputs('qwen_image')).toEqual({
        vae: 'ae.safetensors',
        clip: 'clip_l.safetensors',
        shift: null,
      })
      expect(getModelInputs('aura_flow')).toEqual({
        vae: 'vae-ft.safetensors',
        clip: 't5xxl_fp16.safetensors',
        shift: 3.0,
      })
    })

    it('overwrites existing entry for the same model type', () => {
      const { saveModelInputs, getModelInputs } = useGenerateInputsPersistence()
      saveModelInputs('qwen_image', { vae: 'old-vae.safetensors', clip: 'old-clip.safetensors', shift: null })
      saveModelInputs('qwen_image', { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })

      expect(getModelInputs('qwen_image')).toEqual({
        vae: 'ae.safetensors',
        clip: 'clip_l.safetensors',
        shift: null,
      })
    })

    it('preserves lastWorkflowId when saving model inputs', () => {
      const state: GenerateInputsState = { lastWorkflowId: 'qwen-image.json', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveModelInputs, getLastWorkflowId } = useGenerateInputsPersistence()
      saveModelInputs('qwen_image', { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })

      expect(getLastWorkflowId()).toBe('qwen-image.json')
    })

    it('saves inputs with null vae and clip', () => {
      const { saveModelInputs, getModelInputs } = useGenerateInputsPersistence()
      saveModelInputs('qwen_image', { vae: null, clip: null, shift: null })
      expect(getModelInputs('qwen_image')).toEqual({ vae: null, clip: null, shift: null })
    })
  })

  // ── validation / corruption handling ──────────────────────────────────────

  describe('invalid stored state', () => {
    it.each([
      ['missing byModelType', JSON.stringify({ lastWorkflowId: 'wf.json' })],
      ['null value', 'null'],
      ['array', '[]'],
      ['byModelType is not an object', JSON.stringify({ lastWorkflowId: null, byModelType: 'bad' })],
      [
        'byModelType entry missing vae',
        JSON.stringify({ lastWorkflowId: null, byModelType: { t: { clip: 'c', shift: null } } }),
      ],
      [
        'byModelType entry vae wrong type',
        JSON.stringify({ lastWorkflowId: null, byModelType: { t: { vae: 42, clip: 'c', shift: null } } }),
      ],
    ])('returns defaults when storage contains %s', (_label, rawValue) => {
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, rawValue)
      const { getLastWorkflowId, getModelInputs } = useGenerateInputsPersistence()
      expect(getLastWorkflowId()).toBeNull()
      expect(getModelInputs('t')).toBeNull()
    })
  })
})

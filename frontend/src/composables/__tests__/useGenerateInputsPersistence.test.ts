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

    it('preserves an existing workflowId when saving vae/clip/shift inputs', () => {
      // Simulate: user picks workflow first (saves workflowId), then changes VAE (saves model inputs).
      // The workflowId must survive the second save.
      const { saveWorkflowIdForModelType, saveModelInputs, getWorkflowIdForModelType } =
        useGenerateInputsPersistence()

      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')
      saveModelInputs('qwen_image', { vae: 'ae.safetensors', clip: null, shift: null })

      expect(getWorkflowIdForModelType('qwen_image')).toBe('qwen-image.json')
    })
  })

  // ── getLastTrainingRunId (AC3) ──────────────────────────────────────────

  describe('getLastTrainingRunId', () => {
    it('returns null when storage is empty', () => {
      const { getLastTrainingRunId } = useGenerateInputsPersistence()
      expect(getLastTrainingRunId()).toBeNull()
    })

    it('returns the stored training run ID', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, lastTrainingRunId: 42, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastTrainingRunId } = useGenerateInputsPersistence()
      expect(getLastTrainingRunId()).toBe(42)
    })

    it('returns null when lastTrainingRunId is missing (backward compat)', () => {
      // Old state format without lastTrainingRunId
      const state = { lastWorkflowId: 'wf.json', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastTrainingRunId } = useGenerateInputsPersistence()
      expect(getLastTrainingRunId()).toBeNull()
    })

    it('returns null when lastTrainingRunId is null', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, lastTrainingRunId: null, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastTrainingRunId } = useGenerateInputsPersistence()
      expect(getLastTrainingRunId()).toBeNull()
    })
  })

  // ── saveTrainingRunId (AC3) ──────────────────────────────────────────────

  describe('saveTrainingRunId', () => {
    it('saves a training run ID to localStorage', () => {
      const { saveTrainingRunId, getLastTrainingRunId } = useGenerateInputsPersistence()
      saveTrainingRunId(7)
      expect(getLastTrainingRunId()).toBe(7)
    })

    it('saves null as the training run ID', () => {
      const { saveTrainingRunId, getLastTrainingRunId } = useGenerateInputsPersistence()
      saveTrainingRunId(42)
      saveTrainingRunId(null)
      expect(getLastTrainingRunId()).toBeNull()
    })

    it('preserves other fields when saving a training run ID', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        lastTrainingRunId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveTrainingRunId, getLastWorkflowId, getModelInputs } = useGenerateInputsPersistence()
      saveTrainingRunId(5)

      expect(getLastWorkflowId()).toBe('qwen-image.json')
      expect(getModelInputs('qwen_image')).toEqual({ vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })
    })
  })

  // ── getLastStudyId ──────────────────────────────────────────────────────

  describe('getLastStudyId', () => {
    it('returns null when storage is empty', () => {
      const { getLastStudyId } = useGenerateInputsPersistence()
      expect(getLastStudyId()).toBeNull()
    })

    it('returns the stored study ID', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, lastStudyId: 'study-abc', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastStudyId } = useGenerateInputsPersistence()
      expect(getLastStudyId()).toBe('study-abc')
    })

    it('returns null when lastStudyId is missing (backward compat)', () => {
      // Old state format without lastStudyId
      const state = { lastWorkflowId: 'wf.json', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastStudyId } = useGenerateInputsPersistence()
      expect(getLastStudyId()).toBeNull()
    })

    it('returns null when lastStudyId is null', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, lastStudyId: null, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { getLastStudyId } = useGenerateInputsPersistence()
      expect(getLastStudyId()).toBeNull()
    })
  })

  // ── saveStudyId ──────────────────────────────────────────────────────────

  describe('saveStudyId', () => {
    it('saves a study ID to localStorage', () => {
      const { saveStudyId, getLastStudyId } = useGenerateInputsPersistence()
      saveStudyId('study-xyz')
      expect(getLastStudyId()).toBe('study-xyz')
    })

    it('saves null as the study ID', () => {
      const { saveStudyId, getLastStudyId } = useGenerateInputsPersistence()
      saveStudyId('study-abc')
      saveStudyId(null)
      expect(getLastStudyId()).toBeNull()
    })

    it('preserves other fields when saving a study ID', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        lastTrainingRunId: 5,
        lastStudyId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveStudyId, getLastWorkflowId, getLastTrainingRunId, getModelInputs } = useGenerateInputsPersistence()
      saveStudyId('study-new')

      expect(getLastWorkflowId()).toBe('qwen-image.json')
      expect(getLastTrainingRunId()).toBe(5)
      expect(getModelInputs('qwen_image')).toEqual({ vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null })
    })
  })

  // ── getHasSamplesFilter (AC1) ───────────────────────────────────────────

  describe('getHasSamplesFilter', () => {
    it('returns null when storage is empty', () => {
      const { getHasSamplesFilter } = useGenerateInputsPersistence()
      expect(getHasSamplesFilter()).toBeNull()
    })

    it('returns true when stored as true', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, hasSamplesFilter: true, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getHasSamplesFilter } = useGenerateInputsPersistence()
      expect(getHasSamplesFilter()).toBe(true)
    })

    it('returns false when stored as false', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, hasSamplesFilter: false, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getHasSamplesFilter } = useGenerateInputsPersistence()
      expect(getHasSamplesFilter()).toBe(false)
    })

    it('returns null when hasSamplesFilter is absent (backward compat)', () => {
      const state = { lastWorkflowId: null, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getHasSamplesFilter } = useGenerateInputsPersistence()
      expect(getHasSamplesFilter()).toBeNull()
    })
  })

  // ── saveHasSamplesFilter (AC1) ──────────────────────────────────────────

  describe('saveHasSamplesFilter', () => {
    it('saves true to localStorage', () => {
      const { saveHasSamplesFilter, getHasSamplesFilter } = useGenerateInputsPersistence()
      saveHasSamplesFilter(true)
      expect(getHasSamplesFilter()).toBe(true)
    })

    it('saves false to localStorage', () => {
      const { saveHasSamplesFilter, getHasSamplesFilter } = useGenerateInputsPersistence()
      saveHasSamplesFilter(false)
      expect(getHasSamplesFilter()).toBe(false)
    })

    it('saves null to localStorage', () => {
      const { saveHasSamplesFilter, getHasSamplesFilter } = useGenerateInputsPersistence()
      saveHasSamplesFilter(true)
      saveHasSamplesFilter(null)
      expect(getHasSamplesFilter()).toBeNull()
    })

    it('preserves other fields when saving hasSamplesFilter', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        lastTrainingRunId: 5,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveHasSamplesFilter, getLastWorkflowId, getLastTrainingRunId } = useGenerateInputsPersistence()
      saveHasSamplesFilter(true)

      expect(getLastWorkflowId()).toBe('qwen-image.json')
      expect(getLastTrainingRunId()).toBe(5)
    })
  })

  // ── getWorkflowIdForModelType (AC3) ───────────────────────────────────────

  describe('getWorkflowIdForModelType', () => {
    it('returns null when no entry exists for the given model type', () => {
      const { getWorkflowIdForModelType } = useGenerateInputsPersistence()
      expect(getWorkflowIdForModelType('qwen_image')).toBeNull()
    })

    it('returns null when model type exists but has no workflowId', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getWorkflowIdForModelType } = useGenerateInputsPersistence()
      expect(getWorkflowIdForModelType('qwen_image')).toBeNull()
    })

    it('returns the stored workflowId for a model type', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null, workflowId: 'qwen-image.json' },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getWorkflowIdForModelType } = useGenerateInputsPersistence()
      expect(getWorkflowIdForModelType('qwen_image')).toBe('qwen-image.json')
    })

    it('returns null for a different model type', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: null, clip: null, shift: null, workflowId: 'qwen-image.json' },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getWorkflowIdForModelType } = useGenerateInputsPersistence()
      expect(getWorkflowIdForModelType('aura_flow')).toBeNull()
    })
  })

  // ── saveWorkflowIdForModelType (AC3) ────────────────────────────────────────

  describe('saveWorkflowIdForModelType', () => {
    it('saves a workflow ID for a model type', () => {
      const { saveWorkflowIdForModelType, getWorkflowIdForModelType } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')
      expect(getWorkflowIdForModelType('qwen_image')).toBe('qwen-image.json')
    })

    it('saves null workflow ID for a model type', () => {
      const { saveWorkflowIdForModelType, getWorkflowIdForModelType } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')
      saveWorkflowIdForModelType('qwen_image', null)
      expect(getWorkflowIdForModelType('qwen_image')).toBeNull()
    })

    it('saves independent workflow IDs for different model types', () => {
      const { saveWorkflowIdForModelType, getWorkflowIdForModelType } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')
      saveWorkflowIdForModelType('aura_flow', 'auraflow.json')

      expect(getWorkflowIdForModelType('qwen_image')).toBe('qwen-image.json')
      expect(getWorkflowIdForModelType('aura_flow')).toBe('auraflow.json')
    })

    it('preserves existing vae/clip/shift when saving workflow for a model type', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveWorkflowIdForModelType, getModelInputs } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')

      const inputs = getModelInputs('qwen_image')
      expect(inputs?.vae).toBe('ae.safetensors')
      expect(inputs?.clip).toBe('clip_l.safetensors')
      expect(inputs?.shift).toBeNull()
    })

    it('creates a new model type entry when saving workflow for a new model type', () => {
      const { saveWorkflowIdForModelType, getWorkflowIdForModelType, getModelInputs } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('new_model', 'new-workflow.json')

      expect(getWorkflowIdForModelType('new_model')).toBe('new-workflow.json')
      const inputs = getModelInputs('new_model')
      expect(inputs?.vae).toBeNull()
      expect(inputs?.clip).toBeNull()
      expect(inputs?.shift).toBeNull()
    })

    it('preserves lastWorkflowId when saving model-type workflow', () => {
      const state: GenerateInputsState = { lastWorkflowId: 'global.json', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveWorkflowIdForModelType, getLastWorkflowId } = useGenerateInputsPersistence()
      saveWorkflowIdForModelType('qwen_image', 'qwen-image.json')

      expect(getLastWorkflowId()).toBe('global.json')
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

    it('returns defaults when lastTrainingRunId is wrong type', () => {
      const state = { lastWorkflowId: null, lastTrainingRunId: 'not-a-number', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getLastTrainingRunId } = useGenerateInputsPersistence()
      // Should fall back to defaults because validation fails
      expect(getLastTrainingRunId()).toBeNull()
    })

    it('returns defaults when lastStudyId is wrong type', () => {
      const state = { lastWorkflowId: null, lastStudyId: 42, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getLastStudyId } = useGenerateInputsPersistence()
      // Should fall back to defaults because validation fails
      expect(getLastStudyId()).toBeNull()
    })

    it('returns defaults when hasSamplesFilter is wrong type', () => {
      const state = { lastWorkflowId: null, hasSamplesFilter: 'not-a-boolean', byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getHasSamplesFilter } = useGenerateInputsPersistence()
      // Should fall back to defaults because validation fails
      expect(getHasSamplesFilter()).toBeNull()
    })

    it('returns defaults when byModelType entry has workflowId of wrong type', () => {
      const state = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: null, clip: null, shift: null, workflowId: 42 },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getWorkflowIdForModelType } = useGenerateInputsPersistence()
      // Should fall back to defaults because validation fails
      expect(getWorkflowIdForModelType('qwen_image')).toBeNull()
    })

    it('returns defaults when modelTypeByRunId entry is not a string', () => {
      const state = {
        lastWorkflowId: null,
        byModelType: {},
        modelTypeByRunId: { '1': 42 }, // wrong type: number instead of string
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getModelTypeForRun } = useGenerateInputsPersistence()
      // Should fall back to defaults because validation fails
      expect(getModelTypeForRun(1)).toBeNull()
    })
  })

  // ── getModelTypeForRun / saveModelTypeForRun (S-119) ──────────────────────

  describe('getModelTypeForRun', () => {
    it('returns null when storage is empty', () => {
      const { getModelTypeForRun } = useGenerateInputsPersistence()
      expect(getModelTypeForRun(1)).toBeNull()
    })

    it('returns null when modelTypeByRunId is absent from stored state', () => {
      const state: GenerateInputsState = { lastWorkflowId: null, byModelType: {} }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getModelTypeForRun } = useGenerateInputsPersistence()
      expect(getModelTypeForRun(1)).toBeNull()
    })

    it('returns null when run ID is not in the cache', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {},
        modelTypeByRunId: { '2': 'qwen_image' },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getModelTypeForRun } = useGenerateInputsPersistence()
      expect(getModelTypeForRun(1)).toBeNull()
    })

    it('returns the cached model type for a run ID', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {},
        modelTypeByRunId: { '1': 'qwen_image', '2': 'aura_flow' },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))
      const { getModelTypeForRun } = useGenerateInputsPersistence()
      expect(getModelTypeForRun(1)).toBe('qwen_image')
      expect(getModelTypeForRun(2)).toBe('aura_flow')
    })
  })

  describe('saveModelTypeForRun', () => {
    it('saves the model type for a run ID', () => {
      const { saveModelTypeForRun, getModelTypeForRun } = useGenerateInputsPersistence()
      saveModelTypeForRun(1, 'qwen_image')
      expect(getModelTypeForRun(1)).toBe('qwen_image')
    })

    it('saves independent model types for different run IDs', () => {
      const { saveModelTypeForRun, getModelTypeForRun } = useGenerateInputsPersistence()
      saveModelTypeForRun(1, 'qwen_image')
      saveModelTypeForRun(2, 'aura_flow')
      expect(getModelTypeForRun(1)).toBe('qwen_image')
      expect(getModelTypeForRun(2)).toBe('aura_flow')
    })

    it('overwrites an existing entry for the same run ID', () => {
      const { saveModelTypeForRun, getModelTypeForRun } = useGenerateInputsPersistence()
      saveModelTypeForRun(1, 'qwen_image')
      saveModelTypeForRun(1, 'aura_flow')
      expect(getModelTypeForRun(1)).toBe('aura_flow')
    })

    it('preserves other stored fields when saving model type for a run', () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        byModelType: { qwen_image: { vae: 'ae.safetensors', clip: null, shift: null } },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const { saveModelTypeForRun, getLastWorkflowId, getModelInputs } = useGenerateInputsPersistence()
      saveModelTypeForRun(1, 'qwen_image')

      expect(getLastWorkflowId()).toBe('qwen-image.json')
      expect(getModelInputs('qwen_image')?.vae).toBe('ae.safetensors')
    })

    it('preserves existing modelTypeByRunId entries when adding a new one', () => {
      const { saveModelTypeForRun, getModelTypeForRun } = useGenerateInputsPersistence()
      saveModelTypeForRun(1, 'qwen_image')
      saveModelTypeForRun(2, 'aura_flow')
      // Ensure first entry is still present after adding second
      expect(getModelTypeForRun(1)).toBe('qwen_image')
    })
  })
})

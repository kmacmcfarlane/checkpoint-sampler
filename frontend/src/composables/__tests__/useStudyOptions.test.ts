import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import {
  useStudyOptions,
  FALLBACK_SAMPLERS,
  FALLBACK_SCHEDULERS,
  type UseStudyOptions,
} from '../useStudyOptions'
import type { WorkflowSummary } from '../../api/types'

// Mock the api client — only the endpoints useStudyOptions calls.
vi.mock('../../api/client', () => ({
  apiClient: {
    getComfyUIModels: vi.fn(),
    listWorkflows: vi.fn(),
  },
}))
import { apiClient } from '../../api/client'
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>
const mockListWorkflows = apiClient.listWorkflows as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    name: 'wf-a',
    validation_state: 'valid',
    roles: {},
    warnings: [],
    lora_capable: false,
    ...overrides,
  }
}

function setup(): UseStudyOptions {
  const workflowTemplate = ref<string | null>(null)
  return useStudyOptions({ workflowTemplate })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Sampler / scheduler fallback
// ---------------------------------------------------------------------------

describe('useStudyOptions sampler/scheduler fallback', () => {
  // AC: sampler fallback on thrown error
  it('falls back to FALLBACK_SAMPLERS when the sampler request throws', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.reject(new Error('ComfyUI unavailable'))
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSamplers.value).toEqual(FALLBACK_SAMPLERS)
  })

  // AC: sampler fallback on empty models array (genuinely uncovered ternary branch)
  it('falls back to FALLBACK_SAMPLERS when the sampler request resolves with an empty list', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve({ models: [] })
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSamplers.value).toEqual(FALLBACK_SAMPLERS)
  })

  it('uses the ComfyUI-provided sampler list when non-empty', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'sampler') return Promise.resolve({ models: ['custom_sampler'] })
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSamplers.value).toEqual(['custom_sampler'])
  })

  // AC: scheduler fallback on thrown error
  it('falls back to FALLBACK_SCHEDULERS when the scheduler request throws', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'scheduler') return Promise.reject(new Error('ComfyUI unavailable'))
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSchedulers.value).toEqual(FALLBACK_SCHEDULERS)
  })

  // AC: scheduler fallback on empty models array (genuinely uncovered ternary branch)
  it('falls back to FALLBACK_SCHEDULERS when the scheduler request resolves with an empty list', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'scheduler') return Promise.resolve({ models: [] })
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSchedulers.value).toEqual(FALLBACK_SCHEDULERS)
  })

  it('uses the ComfyUI-provided scheduler list when non-empty', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'scheduler') return Promise.resolve({ models: ['custom_scheduler'] })
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableSchedulers.value).toEqual(['custom_scheduler'])
  })
})

// ---------------------------------------------------------------------------
// VAE / CLIP — no fallback, degrade to empty list
// ---------------------------------------------------------------------------

describe('useStudyOptions VAE/CLIP degradation', () => {
  it('degrades availableVAE to an empty list on failure', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'vae') return Promise.reject(new Error('boom'))
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableVAE.value).toEqual([])
  })

  it('degrades availableCLIP to an empty list on failure', async () => {
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'clip') return Promise.reject(new Error('boom'))
      return Promise.resolve({ models: [] })
    })
    mockListWorkflows.mockResolvedValue([])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableCLIP.value).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// workflowOptions filtering
// ---------------------------------------------------------------------------

describe('useStudyOptions.workflowOptions', () => {
  // AC: workflowOptions filters out non-valid validation_state
  it('filters out workflows whose validation_state is not "valid"', async () => {
    mockGetComfyUIModels.mockResolvedValue({ models: [] })
    mockListWorkflows.mockResolvedValue([
      makeWorkflow({ name: 'valid-wf', validation_state: 'valid' }),
      makeWorkflow({ name: 'invalid-wf', validation_state: 'invalid' }),
    ])
    const composable = setup()

    await composable.fetchAll()

    expect(composable.workflowOptions.value).toEqual([{ label: 'valid-wf', value: 'valid-wf' }])
  })

  it('degrades availableWorkflows to an empty list on failure', async () => {
    mockGetComfyUIModels.mockResolvedValue({ models: [] })
    mockListWorkflows.mockRejectedValue(new Error('boom'))
    const composable = setup()

    await composable.fetchAll()

    expect(composable.availableWorkflows.value).toEqual([])
    expect(composable.workflowOptions.value).toEqual([])
  })
})

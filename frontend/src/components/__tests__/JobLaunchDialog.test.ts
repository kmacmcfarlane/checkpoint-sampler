import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, type VNode } from 'vue'
import { NModal, NSelect, NInputNumber, NButton, NCheckbox } from 'naive-ui'
import JobLaunchDialog from '../JobLaunchDialog.vue'
import StudyEditor from '../StudyEditor.vue'
import type { TrainingRun, WorkflowSummary, Study, SampleJob } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn(),
    getCheckpointTrainingRuns: vi.fn(),
    listSampleJobs: vi.fn(),
    listWorkflows: vi.fn(),
    listStudies: vi.fn(),
    getComfyUIModels: vi.fn(),
    createSampleJob: vi.fn(),
    createStudy: vi.fn(),
    updateStudy: vi.fn(),
    deleteStudy: vi.fn(),
    getCheckpointMetadata: vi.fn(),
    validateTrainingRun: vi.fn(),
    getStudyAvailability: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'
import { GENERATE_INPUTS_STORAGE_KEY } from '../../composables/useGenerateInputsPersistence'
import type { GenerateInputsState } from '../../composables/useGenerateInputsPersistence'

const mockGetCheckpointTrainingRuns = apiClient.getCheckpointTrainingRuns as ReturnType<typeof vi.fn>
const mockListSampleJobs = apiClient.listSampleJobs as ReturnType<typeof vi.fn>
const mockListWorkflows = apiClient.listWorkflows as ReturnType<typeof vi.fn>
const mockListStudies = apiClient.listStudies as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>
const mockCreateSampleJob = apiClient.createSampleJob as ReturnType<typeof vi.fn>
const mockGetCheckpointMetadata = apiClient.getCheckpointMetadata as ReturnType<typeof vi.fn>
const mockValidateTrainingRun = apiClient.validateTrainingRun as ReturnType<typeof vi.fn>
const mockGetStudyAvailability = apiClient.getStudyAvailability as ReturnType<typeof vi.fn>

// Training run without samples (gray)
const runEmpty: TrainingRun = {
  id: 1,
  name: 'qwen/psai4rt-v0.3.0',
  checkpoint_count: 5,
  has_samples: false,
  checkpoints: [
    { filename: 'checkpoint1.safetensors', step_number: 1000, has_samples: false },
    { filename: 'checkpoint2.safetensors', step_number: 2000, has_samples: false },
  ],
}

// Training run with samples (green)
const runWithSamples: TrainingRun = {
  id: 2,
  name: 'qwen/psai4rt-v0.4.0',
  checkpoint_count: 3,
  has_samples: true,
  checkpoints: [
    { filename: 'chk-a.safetensors', step_number: 1000, has_samples: true },
    { filename: 'chk-b.safetensors', step_number: 2000, has_samples: false },
    { filename: 'chk-c.safetensors', step_number: 3000, has_samples: true },
  ],
}

// Training run with a running job (blue)
const runRunning: TrainingRun = {
  id: 3,
  name: 'qwen/psai4rt-v0.5.0',
  checkpoint_count: 2,
  has_samples: false,
  checkpoints: [
    { filename: 'chk-x.safetensors', step_number: 500, has_samples: false },
  ],
}

const sampleWorkflows: WorkflowSummary[] = [
  {
    name: 'qwen-image.json',
    validation_state: 'valid',
    roles: { save_image: ['9'], unet_loader: ['4'] },
    warnings: [],
  },
  {
    name: 'auraflow-image.json',
    validation_state: 'valid',
    roles: { save_image: ['9'], unet_loader: ['4'], shift: ['3'] },
    warnings: [],
  },
  {
    name: 'invalid-workflow.json',
    validation_state: 'invalid',
    roles: {},
    warnings: ['Missing required roles'],
  },
]

const sampleStudies: Study[] = [
  {
    id: 'preset-1',
    name: 'Quick Test',
    prompt_prefix: '',
    prompts: [{ name: 'test', text: 'a photo' }],
    negative_prompt: 'bad quality',
    steps: [20],
    cfgs: [7.0],
    sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
    seeds: [42],
    width: 1024,
    height: 1024,
    images_per_checkpoint: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-2',
    name: 'Full Test',
    prompt_prefix: '',
    prompts: [
      { name: 'test1', text: 'a photo' },
      { name: 'test2', text: 'another photo' },
    ],
    negative_prompt: '',
    steps: [1, 4, 8],
    cfgs: [1.0, 7.0],
    sampler_scheduler_pairs: [
      { sampler: 'euler', scheduler: 'normal' },
      { sampler: 'dpmpp_2m', scheduler: 'karras' },
    ],
    seeds: [42, 420],
    width: 1024,
    height: 1024,
    images_per_checkpoint: 48,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const vaeModels = ['ae.safetensors', 'vae-ft-mse.safetensors']
const clipModels = ['clip_l.safetensors', 't5xxl_fp16.safetensors']

const runningJob: SampleJob = {
  id: 'job-running',
  training_run_name: 'qwen/psai4rt-v0.5.0',
  study_id: 'preset-1', study_name: 'Quick Test',
  workflow_name: 'qwen-image.json',
  vae: 'ae.safetensors',
  clip: 'clip_l.safetensors',
  status: 'running',
  total_items: 10,
  completed_items: 2,
  failed_items: 0,
  pending_items: 8,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const allTrainingRuns = [runEmpty, runWithSamples, runRunning]

// Helper validation results matching each training run's checkpoints.
// The checkpoint picker now uses validation results (not raw training run checkpoints),
// so tests that interact with the checkpoint list must provide matching validation data.
const validationForRunWithSamples = {
  checkpoints: [
    { checkpoint: 'chk-a.safetensors', expected: 1, verified: 1, missing: 0 },
    { checkpoint: 'chk-b.safetensors', expected: 1, verified: 0, missing: 1 },
    { checkpoint: 'chk-c.safetensors', expected: 1, verified: 1, missing: 0 },
  ],
  expected_per_checkpoint: 1,
  total_expected: 3,
  total_verified: 2,
  total_actual: 2,
  total_missing: 1,
}

const validationForRunEmpty = {
  checkpoints: [
    { checkpoint: 'checkpoint1.safetensors', expected: 0, verified: 0, missing: 0 },
    { checkpoint: 'checkpoint2.safetensors', expected: 0, verified: 0, missing: 0 },
  ],
  expected_per_checkpoint: 0,
  total_expected: 0,
  total_verified: 0,
  total_actual: 0,
  total_missing: 0,
}

// enableAutoUnmount is configured globally in vitest.setup.ts

describe('JobLaunchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGetCheckpointTrainingRuns.mockResolvedValue(allTrainingRuns)
    mockListSampleJobs.mockResolvedValue([runningJob])
    mockListWorkflows.mockResolvedValue(sampleWorkflows)
    mockListStudies.mockResolvedValue(sampleStudies)
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'vae') return Promise.resolve({ models: vaeModels })
      if (type === 'clip') return Promise.resolve({ models: clipModels })
      return Promise.resolve({ models: [] })
    })
    // Default: no checkpoint metadata (empty ss_* fields)
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
    // Default: no study availability data (tests that need it will override)
    mockGetStudyAvailability.mockResolvedValue([])
    // Default: validation returns empty result (no samples)
    mockValidateTrainingRun.mockResolvedValue({
      checkpoints: [],
      expected_per_checkpoint: 0,
      total_expected: 0,
      total_verified: 0,
      total_actual: 0,
      total_missing: 0,
    })
  })

  it('renders a modal with title "Generate Samples"', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('title')).toBe('Generate Samples')
  })

  it('fetches training runs, jobs, workflows, studies, and ComfyUI models on mount', async () => {
    mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(mockGetCheckpointTrainingRuns).toHaveBeenCalledTimes(1)
    expect(mockListSampleJobs).toHaveBeenCalledTimes(1)
    expect(mockListWorkflows).toHaveBeenCalledTimes(1)
    expect(mockListStudies).toHaveBeenCalled()
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('vae')
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('clip')
  })

  it('starts with no training run pre-selected', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
    expect(runSelect.props('value')).toBeNull()
  })

  describe('training run filter (show all / show empty)', () => {
    it('"Show all" checkbox is checked by default', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)
    })

    it('shows all runs by default (show all is checked)', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number }>
      // All three runs are visible when showAllRuns is true (the default)
      expect(options).toHaveLength(3)
    })

    it('shows only empty runs when "show all" checkbox is unchecked', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', false)
      await nextTick()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number }>
      // runEmpty (id=1) is gray (no samples, no jobs) — should appear
      // runWithSamples (id=2) is green (has_samples) — hidden when showAllRuns=false
      // runRunning (id=3) has a running job — hidden when showAllRuns=false
      expect(options).toHaveLength(1)
      expect(options[0].value).toBe(1)
    })
  })

  describe('status bead rendering via renderLabel', () => {
    it('sets the renderLabel prop on the training run select', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(typeof runSelect.props('renderLabel')).toBe('function')
    })

    it('training run options carry _status and _color metadata for bead rendering', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Show all runs to get all three statuses
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number; _status: string; _color: string }>

      // runEmpty (id=1): no samples, no jobs → gray
      const emptyOpt = options.find(o => o.value === 1)
      expect(emptyOpt?._status).toBe('empty')
      expect(emptyOpt?._color).toBe('#909090')

      // runWithSamples (id=2): has_samples=true, no active jobs → complete/green
      const completeOpt = options.find(o => o.value === 2)
      expect(completeOpt?._status).toBe('complete')
      expect(completeOpt?._color).toBe('#18a058')

      // runRunning (id=3): has a running job → blue
      const runningOpt = options.find(o => o.value === 3)
      expect(runningOpt?._status).toBe('running')
      expect(runningOpt?._color).toBe('#2080f0')
    })

    it('renderLabel function returns a VNode containing both a bead span and label text', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const renderLabel = runSelect.props('renderLabel') as (option: Record<string, unknown>) => VNode

      const vnode = renderLabel({
        label: 'my-run',
        value: 99,
        _status: 'complete',
        _color: '#18a058',
      })

      // The returned VNode should be a div containing two children: bead span + label span
      expect(vnode).toBeTruthy()
      const children = (vnode as { children?: unknown[] }).children
      expect(Array.isArray(children)).toBe(true)
      expect((children as unknown[]).length).toBe(2)
    })
  })

  it('populates workflow select with valid workflows only', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const workflowSelect = wrapper.find('[data-testid="workflow-select"]')
    const select = workflowSelect.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options.map(o => o.value)).toEqual(['qwen-image.json', 'auraflow-image.json'])
  })

  it('populates study select with all studies', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const studySelect = wrapper.find('[data-testid="study-select"]')
    const select = studySelect.findComponent(NSelect)
    const options = select.props('options') as Array<{ label: string; value: string }>
    expect(options).toHaveLength(2)
    expect(options.map(o => o.label)).toEqual(['Quick Test', 'Full Test'])
  })

  it('shows shift input only when workflow has shift role', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // No shift input initially
    expect(wrapper.find('[data-testid="shift-input"]').exists()).toBe(false)

    // Select workflow with shift role
    const workflowSelect = wrapper.find('[data-testid="workflow-select"]')
    const select = workflowSelect.findComponent(NSelect)
    select.vm.$emit('update:value', 'auraflow-image.json')
    await nextTick()

    // Shift input should appear
    expect(wrapper.find('[data-testid="shift-input"]').exists()).toBe(true)
  })

  it('displays confirmation summary with N/A when no training run selected', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const summary = wrapper.find('[data-testid="job-summary"]')
    expect(summary.text()).toContain('Training Run: N/A')
  })

  it('displays confirmation summary with correct values when run and study selected', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Show all runs and select the empty run
    wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
    await nextTick()

    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    await nextTick()

    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
    await nextTick()

    const summary = wrapper.find('[data-testid="job-summary"]')
    expect(summary.text()).toContain('Training Run: qwen/psai4rt-v0.3.0')
    expect(summary.text()).toContain('Checkpoints: 5')
    expect(summary.text()).toContain('Images per checkpoint: 48')
    expect(summary.text()).toContain('Total images: 240')
  })

  it('disables submit button when required fields are missing', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples' || b.text() === 'Regenerate Samples')
    expect(submitButton).toBeDefined()
    expect(submitButton!.props('disabled')).toBe(true)
  })

  it('enables submit button when all required fields are filled for an empty run', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    await nextTick()

    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    await nextTick()

    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    await nextTick()

    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    await nextTick()

    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    expect(submitButton!.props('disabled')).toBe(false)
  })

  it('creates sample job with correct payload for an empty training run', async () => {
    const mockJob: SampleJob = {
      id: 'job-1',
      training_run_name: 'qwen/psai4rt-v0.3.0',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'qwen-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
      status: 'running',
      total_items: 5,
      completed_items: 0,
      failed_items: 0,
      pending_items: 5,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreateSampleJob.mockResolvedValue(mockJob)

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select empty run (only one shown by default)
    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(mockCreateSampleJob).toHaveBeenCalledWith({
      training_run_name: 'qwen/psai4rt-v0.3.0',
      study_id: 'preset-1',
      workflow_name: 'qwen-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
    })
  })

  it('includes shift value in payload when workflow has shift role', async () => {
    const mockJob: SampleJob = {
      id: 'job-1',
      training_run_name: 'qwen/psai4rt-v0.3.0',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'auraflow-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
      shift: 3.0,
      status: 'running',
      total_items: 5,
      completed_items: 0,
      failed_items: 0,
      pending_items: 5,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreateSampleJob.mockResolvedValue(mockJob)

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'auraflow-image.json')
    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    wrapper.find('[data-testid="shift-input"]').findComponent(NInputNumber).vm.$emit('update:value', 3.0)
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(mockCreateSampleJob).toHaveBeenCalledWith({
      training_run_name: 'qwen/psai4rt-v0.3.0',
      study_id: 'preset-1',
      workflow_name: 'auraflow-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
      shift: 3.0,
    })
  })

  it('emits success event and closes on successful submission', async () => {
    mockCreateSampleJob.mockResolvedValue({
      id: 'job-1',
      training_run_name: 'qwen/psai4rt-v0.3.0',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'qwen-image.json',
      status: 'running',
      total_items: 5,
      completed_items: 0,
      failed_items: 0,
      pending_items: 5,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    })

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('success')).toBeDefined()
    expect(wrapper.emitted('update:show')).toBeDefined()
  })

  it('displays error message on submission failure', async () => {
    mockCreateSampleJob.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Failed to create job' })

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to create job')
  })

  it('renders a "Manage Studies" button next to the study selector', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const manageButton = wrapper.find('[data-testid="manage-studies-button"]')
    expect(manageButton.exists()).toBe(true)
    expect(manageButton.text()).toBe('Manage Studies')
  })

  it('opens the study editor modal when "Manage Studies" is clicked', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // The study editor modal should be hidden initially
    const modals = wrapper.findAllComponents(NModal)
    const editorModal = modals.find(m => m.props('title') === 'Manage Studies')
    expect(editorModal).toBeDefined()
    expect(editorModal!.props('show')).toBe(false)

    // Click "Manage Studies"
    await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
    await nextTick()

    const updatedModals = wrapper.findAllComponents(NModal)
    const openedEditorModal = updatedModals.find(m => m.props('title') === 'Manage Studies')
    expect(openedEditorModal!.props('show')).toBe(true)
  })

  it('refreshes study list and auto-selects study when study-saved is emitted from editor', async () => {
    const newStudy: Study = {
      id: 'preset-new',
      name: 'Newly Created',
      prompt_prefix: '',
      prompts: [{ name: 'test', text: 'a test' }],
      negative_prompt: '',
      steps: [20],
      cfgs: [7.0],
      sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
      seeds: [42],
      width: 1024,
      height: 1024,
      images_per_checkpoint: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    const updatedStudies = [...sampleStudies, newStudy]
    mockListStudies
      .mockResolvedValueOnce(sampleStudies)  // initial dialog load
      .mockResolvedValueOnce(sampleStudies)  // StudyEditor own mount load
      .mockResolvedValueOnce(updatedStudies) // dialog refresh after study-saved

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
    expect((studySelect.props('options') as Array<{ label: string; value: string }>)).toHaveLength(2)

    await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
    await flushPromises()

    const editor = wrapper.findComponent(StudyEditor)
    await editor.vm.$emit('study-saved', newStudy)
    await flushPromises()

    const refreshedOptions = studySelect.props('options') as Array<{ label: string; value: string }>
    expect(refreshedOptions).toHaveLength(3)
    expect(refreshedOptions[2].label).toBe('Newly Created')
    expect(studySelect.props('value')).toBe('preset-new')
  })

  it('clears selected study when study-deleted is emitted for the selected study', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
    studySelect.vm.$emit('update:value', 'preset-1')
    await nextTick()

    await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
    await nextTick()

    const studiesWithoutFirst = sampleStudies.filter(p => p.id !== 'preset-1')
    mockListStudies.mockResolvedValueOnce(studiesWithoutFirst)

    const editor = wrapper.findComponent(StudyEditor)
    await editor.vm.$emit('study-deleted', 'preset-1')
    await flushPromises()

    expect(studySelect.props('value')).toBeNull()

    const refreshedOptions = studySelect.props('options') as Array<{ label: string; value: string }>
    expect(refreshedOptions).toHaveLength(1)
    expect(refreshedOptions[0].label).toBe('Full Test')
  })

  describe('study selection sync between parent and sub-dialog', () => {
    // AC: When opening the sub-dialog, the currently selected study in the parent is pre-selected.
    it('passes the currently selected study ID as initialStudyId to StudyEditor', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a study in the parent dialog
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Open the manage studies sub-dialog
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await nextTick()

      // The StudyEditor should receive the currently selected study ID
      const editor = wrapper.findComponent(StudyEditor)
      expect(editor.props('initialStudyId')).toBe('preset-1')
    })

    // AC: If no study is selected in the parent, StudyEditor receives null.
    it('passes null as initialStudyId when no study is selected in the parent', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Do not select any study — open the editor directly
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await nextTick()

      const editor = wrapper.findComponent(StudyEditor)
      expect(editor.props('initialStudyId')).toBeNull()
    })

    // AC: initialStudyId updates when the parent's selected study changes before opening.
    it('passes the updated study ID when a different study is selected before opening', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select preset-1 first, then change to preset-2
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
      await nextTick()

      // Open the editor — should reflect the latest selection
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await nextTick()

      const editor = wrapper.findComponent(StudyEditor)
      expect(editor.props('initialStudyId')).toBe('preset-2')
    })

    // AC: After saving a study in the sub-dialog, parent dropdown reflects the change.
    it('reflects new study in parent dropdown after study-saved from sub-dialog', async () => {
      const newStudy: Study = {
        id: 'preset-new',
        name: 'Synced Preset',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        images_per_checkpoint: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }

      const updatedStudies = [...sampleStudies, newStudy]
      mockListStudies
        .mockResolvedValueOnce(sampleStudies)  // initial dialog load
        .mockResolvedValueOnce(sampleStudies)  // StudyEditor own mount load
        .mockResolvedValueOnce(updatedStudies) // dialog refresh after study-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await flushPromises()

      // Simulate the sub-dialog saving a new study
      const editor = wrapper.findComponent(StudyEditor)
      await editor.vm.$emit('study-saved', newStudy)
      await flushPromises()

      // Parent study dropdown should now contain the new study and have it selected
      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string }>
      expect(options.some(o => o.label === 'Synced Preset')).toBe(true)
      expect(studySelect.props('value')).toBe('preset-new')
    })
  })

  describe('checkpoint picker for regeneration', () => {
    it('does not show checkpoint picker when empty run is selected', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    it('shows checkpoint picker when run with samples is selected and study is chosen', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Show all to see runs with samples
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()

      // AC1: Checkpoint picker requires a study to be selected
      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)

      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await nextTick()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(true)
    })

    it('shows "Select All" and "Deselect All" controls in checkpoint picker', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="select-all-checkpoints"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="deselect-all-checkpoints"]').exists()).toBe(true)
    })
  })

  describe('payload for regeneration', () => {
    it('sends clear_existing=true when a run with samples is selected', async () => {
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-2',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 3,
        completed_items: 0,
        failed_items: 0,
        pending_items: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.clear_existing).toBe(true)
      expect(call.training_run_name).toBe('qwen/psai4rt-v0.4.0')
      // All checkpoints are auto-selected when run has samples
      expect(call.checkpoint_filenames).toEqual(['chk-a.safetensors', 'chk-b.safetensors', 'chk-c.safetensors'])
    })

    it('shows "Regenerate Samples" button text when run has samples', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()

      const buttons = wrapper.findAllComponents(NButton)
      const regenerateButton = buttons.find(b => b.text() === 'Regenerate Samples')
      expect(regenerateButton).toBeDefined()
    })

    it('shows "Generate Samples" button text when run has no samples', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()

      const buttons = wrapper.findAllComponents(NButton)
      const generateButton = buttons.find(b => b.text() === 'Generate Samples')
      expect(generateButton).toBeDefined()
    })
  })

  describe('localStorage persistence', () => {
    it('restores last workflow ID on mount when workflow is still available', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('qwen-image.json')
    })

    it('does not restore workflow ID when it is no longer available', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'deleted-workflow.json',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBeNull()
    })

    it('does not restore invalid workflow (validation_state=invalid) from localStorage', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'invalid-workflow.json',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBeNull()
    })

    it('persists workflow ID to localStorage when workflow is selected', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'auraflow-image.json')
      await nextTick()

      const stored = JSON.parse(localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY) ?? '{}') as GenerateInputsState
      expect(stored.lastWorkflowId).toBe('auraflow-image.json')
    })

    it('restores model-type-specific VAE and CLIP inputs when training run is selected', async () => {
      // Pre-populate persisted state for model type 'qwen_image'
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      // Mock metadata to return ss_base_model_version = 'qwen_image'
      mockGetCheckpointMetadata.mockResolvedValue({
        metadata: { ss_base_model_version: 'qwen_image' },
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select empty run (id=1)
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      const vaeSelect = wrapper.find('[data-testid="vae-select"]').findComponent(NSelect)
      const clipSelect = wrapper.find('[data-testid="clip-select"]').findComponent(NSelect)
      expect(vaeSelect.props('value')).toBe('ae.safetensors')
      expect(clipSelect.props('value')).toBe('clip_l.safetensors')
    })

    it('restores shift value when training run is selected and workflow has shift role', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: 'auraflow-image.json',
        byModelType: {
          aura_flow: { vae: 'ae.safetensors', clip: 't5xxl_fp16.safetensors', shift: 3.0 },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      mockGetCheckpointMetadata.mockResolvedValue({
        metadata: { ss_base_model_version: 'aura_flow' },
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select empty run (id=1)
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      // Workflow is restored, so shift input should appear
      const shiftInput = wrapper.find('[data-testid="shift-input"]').findComponent(NInputNumber)
      expect(shiftInput.props('value')).toBe(3.0)
    })

    it('falls back to null for VAE and CLIP when persisted values are no longer available', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'deleted-vae.safetensors', clip: 'deleted-clip.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      mockGetCheckpointMetadata.mockResolvedValue({
        metadata: { ss_base_model_version: 'qwen_image' },
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      const vaeSelect = wrapper.find('[data-testid="vae-select"]').findComponent(NSelect)
      const clipSelect = wrapper.find('[data-testid="clip-select"]').findComponent(NSelect)
      expect(vaeSelect.props('value')).toBeNull()
      expect(clipSelect.props('value')).toBeNull()
    })

    it('persists VAE and CLIP selections to localStorage when a model type is known', async () => {
      mockGetCheckpointMetadata.mockResolvedValue({
        metadata: { ss_base_model_version: 'qwen_image' },
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a training run so model type is fetched
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      // Now select VAE and CLIP
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      await nextTick()
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

      const stored = JSON.parse(localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY) ?? '{}') as GenerateInputsState
      expect(stored.byModelType['qwen_image']).toEqual({
        vae: 'ae.safetensors',
        clip: 'clip_l.safetensors',
        shift: null,
      })
    })

    it('does not persist VAE/CLIP if model type is unknown (metadata fetch failed)', async () => {
      mockGetCheckpointMetadata.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'fail' })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      await nextTick()

      const stored = JSON.parse(localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY) ?? '{}') as GenerateInputsState
      // byModelType should be empty since model type was never resolved
      expect(Object.keys(stored.byModelType ?? {})).toHaveLength(0)
    })

    it('does not restore model inputs when checkpoint has no ss_base_model_version', async () => {
      // Metadata present but no ss_base_model_version key
      mockGetCheckpointMetadata.mockResolvedValue({
        metadata: { ss_output_name: 'my-model' },
      })

      const state: GenerateInputsState = {
        lastWorkflowId: null,
        byModelType: {
          qwen_image: { vae: 'ae.safetensors', clip: 'clip_l.safetensors', shift: null },
        },
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      // No model type was found, so VAE and CLIP remain null
      const vaeSelect = wrapper.find('[data-testid="vae-select"]').findComponent(NSelect)
      const clipSelect = wrapper.find('[data-testid="clip-select"]').findComponent(NSelect)
      expect(vaeSelect.props('value')).toBeNull()
      expect(clipSelect.props('value')).toBeNull()
    })

    it('fetches checkpoint metadata for the first checkpoint of the selected run', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      // runEmpty has checkpoints[0].filename = 'checkpoint1.safetensors'
      expect(mockGetCheckpointMetadata).toHaveBeenCalledWith('checkpoint1.safetensors')
    })
  })

  describe('failed checkpoint awareness', () => {
    const completedWithErrorsJob: SampleJob = {
      id: 'job-errors',
      training_run_name: 'qwen/psai4rt-v0.4.0',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'qwen-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
      status: 'completed_with_errors',
      total_items: 3,
      completed_items: 1,
      failed_items: 2,
      pending_items: 0,
      failed_item_details: [
        { checkpoint_filename: 'chk-a.safetensors', error_message: 'VRAM overflow' },
        { checkpoint_filename: 'chk-c.safetensors', error_message: 'timeout expired' },
      ],
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    }

    it('shows yellow bead for training run with completed_with_errors jobs (partial samples)', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Show all runs to see runs with errors
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number; _status: string; _color: string }>
      const errorRunOpt = options.find(o => o.value === 2)
      // AC: completed_with_errors → partial (yellow), not red
      expect(errorRunOpt?._status).toBe('partial')
      expect(errorRunOpt?._color).toBe('#f0a020')
    })

    it('pre-selects only failed checkpoints when completed_with_errors run is selected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Show all runs and select run with errors
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      // Select a study so the checkpoint picker is visible (AC1)
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // Check that only failed checkpoints (chk-a, chk-c) are pre-selected
      const chkA = wrapper.find('[data-testid="checkpoint-row-chk-a.safetensors"]').findComponent(NCheckbox)
      expect(chkA.props('checked')).toBe(true)

      const chkB = wrapper.find('[data-testid="checkpoint-row-chk-b.safetensors"]').findComponent(NCheckbox)
      expect(chkB.props('checked')).toBe(false)

      const chkC = wrapper.find('[data-testid="checkpoint-row-chk-c.safetensors"]').findComponent(NCheckbox)
      expect(chkC.props('checked')).toBe(true)
    })

    it('shows failed badge on checkpoints with errors', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      // Select a study so the checkpoint picker is visible (AC1)
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // Failed checkpoints should have a 'failed' badge
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-a.safetensors"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-c.safetensors"]').exists()).toBe(true)

      // Non-failed checkpoint should not have a failed badge
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-b.safetensors"]').exists()).toBe(false)
    })

    it('auto-enables clear_existing when failed checkpoints are pre-selected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      // Select a study so the checkpoint picker is visible (AC1)
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      const clearExistingCheckbox = wrapper.find('[data-testid="clear-existing-checkbox"]').findComponent(NCheckbox)
      expect(clearExistingCheckbox.props('checked')).toBe(true)
    })

    it('disables submit when all checkpoints are deselected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select the run with errors
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      // Fill other required fields
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      // Deselect all checkpoints
      wrapper.find('[data-testid="deselect-all-checkpoints"]').trigger('click')
      await nextTick()

      // Submit should be disabled
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      expect(submitButton!.props('disabled')).toBe(true)

      // Validation message should be shown
      expect(wrapper.find('[data-testid="checkpoint-validation-error"]').exists()).toBe(true)
    })

    it('sends clear_existing and failed checkpoint filenames in payload', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-regen',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 2,
        completed_items: 0,
        failed_items: 0,
        pending_items: 2,
        created_at: '2025-01-02T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      // Submit (failed checkpoints pre-selected: chk-a, chk-c)
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.clear_existing).toBe(true)
      expect(call.checkpoint_filenames).toEqual(expect.arrayContaining(['chk-a.safetensors', 'chk-c.safetensors']))
      expect(call.checkpoint_filenames).toHaveLength(2)
    })

    it('selects all checkpoints for run with samples but no failures', async () => {
      // No jobs with errors
      mockListSampleJobs.mockResolvedValue([])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      // Select a study so the checkpoint picker is visible (AC1)
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // All checkpoints should be selected
      const chkA = wrapper.find('[data-testid="checkpoint-row-chk-a.safetensors"]').findComponent(NCheckbox)
      expect(chkA.props('checked')).toBe(true)

      const chkB = wrapper.find('[data-testid="checkpoint-row-chk-b.safetensors"]').findComponent(NCheckbox)
      expect(chkB.props('checked')).toBe(true)

      const chkC = wrapper.find('[data-testid="checkpoint-row-chk-c.safetensors"]').findComponent(NCheckbox)
      expect(chkC.props('checked')).toBe(true)
    })
  })

  // AC2: Saving a study in the Manage Studies sub-modal auto-closes the sub-modal
  // and returns focus to the job launch dialog.
  describe('study editor auto-close on save (AC2)', () => {
    it('closes the study editor sub-modal after a study is saved', async () => {
      const savedStudy: Study = {
        id: 'preset-1',
        name: 'Quick Test Updated',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a photo' }],
        negative_prompt: 'bad quality',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        images_per_checkpoint: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }

      mockListStudies
        .mockResolvedValueOnce(sampleStudies)  // initial dialog load
        .mockResolvedValueOnce(sampleStudies)  // StudyEditor own mount load
        .mockResolvedValueOnce(sampleStudies)  // dialog refresh after study-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Open the study editor
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await flushPromises()

      // Verify the editor is open
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Studies')
      expect(editorModal!.props('show')).toBe(true)

      // Emit study-saved from the editor
      const editor = wrapper.findComponent(StudyEditor)
      await editor.vm.$emit('study-saved', savedStudy)
      await flushPromises()

      // The editor modal should be closed
      const updatedModals = wrapper.findAllComponents(NModal)
      const closedEditorModal = updatedModals.find(m => m.props('title') === 'Manage Studies')
      expect(closedEditorModal!.props('show')).toBe(false)
    })
  })

  // AC3: Dialog remembers and restores the last selected training run
  describe('training run persistence (AC3)', () => {
    it('persists the selected training run ID to localStorage', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a training run
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()

      // Check that it's persisted
      const stored = JSON.parse(localStorage.getItem(GENERATE_INPUTS_STORAGE_KEY) ?? '{}') as GenerateInputsState
      expect(stored.lastTrainingRunId).toBe(1)
    })

    it('restores the last training run on mount when it is still available', async () => {
      // Pre-populate localStorage with a saved training run ID
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        lastTrainingRunId: 1,
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBe(1)
    })

    it('does not restore training run ID when it is no longer available', async () => {
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        lastTrainingRunId: 999, // Non-existent ID
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBeNull()
    })

    it('restores a non-empty run with show-all enabled (the default)', async () => {
      // runWithSamples (id=2) has status 'complete' — visible because showAllRuns defaults to true
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        lastTrainingRunId: 2,
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // The showAllRuns filter defaults to true so the run is visible in the dropdown
      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)

      // And the run should be selected
      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBe(2)
    })

    it('restores an empty run with show-all enabled (the default)', async () => {
      // runEmpty (id=1) has status 'empty' — visible in default filter since showAllRuns defaults to true
      const state: GenerateInputsState = {
        lastWorkflowId: null,
        lastTrainingRunId: 1,
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // The showAllRuns filter defaults to true
      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)

      // And the run should be selected
      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBe(1)
    })
  })

  // AC4: When a job completes via WebSocket while the dialog is open,
  // training run options and status beads refresh automatically
  describe('auto-refresh on job completion (AC4)', () => {
    it('refetches training runs and jobs when refreshTrigger changes', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, refreshTrigger: 0 },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Clear mock call counts from initial mount
      mockGetCheckpointTrainingRuns.mockClear()
      mockListSampleJobs.mockClear()

      // Simulate a job completion by changing refreshTrigger
      await wrapper.setProps({ refreshTrigger: 1 })
      await flushPromises()

      // fetchTrainingRunsAndJobs should have been called again
      expect(mockGetCheckpointTrainingRuns).toHaveBeenCalledTimes(1)
      expect(mockListSampleJobs).toHaveBeenCalledTimes(1)
    })

    it('updates training run bead status after data refresh', async () => {
      // Initially, runRunning (id=3) has a running job
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, refreshTrigger: 0 },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Show all runs to see all statuses
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      // Verify initial status
      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      let options = runSelect.props('options') as Array<{ value: number; _status: string }>
      let runningOpt = options.find(o => o.value === 3)
      expect(runningOpt?._status).toBe('running')

      // Now simulate job completing: mock returns no running jobs
      mockGetCheckpointTrainingRuns.mockResolvedValue(allTrainingRuns)
      mockListSampleJobs.mockResolvedValue([]) // No active jobs anymore

      // Trigger refresh
      await wrapper.setProps({ refreshTrigger: 1 })
      await flushPromises()

      // Re-check the options — runRunning should now be 'empty'
      options = runSelect.props('options') as Array<{ value: number; _status: string }>
      runningOpt = options.find(o => o.value === 3)
      expect(runningOpt?._status).toBe('empty')
    })
  })

  // AC5: After closing the Manage Studies modal, the study that was last edited
  // is shown as selected in the job dialog dropdown
  describe('study state persistence after editor close (AC5)', () => {
    it('selects the newly created study in the job dialog after study-saved', async () => {
      const newStudy: Study = {
        id: 'preset-new',
        name: 'Brand New Preset',
        prompt_prefix: '',
        prompts: [{ name: 'test', text: 'a test' }],
        negative_prompt: '',
        steps: [20],
        cfgs: [7.0],
        sampler_scheduler_pairs: [{ sampler: 'euler', scheduler: 'normal' }],
        seeds: [42],
        width: 1024,
        height: 1024,
        images_per_checkpoint: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }

      const updatedStudies = [...sampleStudies, newStudy]
      mockListStudies
        .mockResolvedValueOnce(sampleStudies)   // initial dialog load
        .mockResolvedValueOnce(sampleStudies)   // StudyEditor own mount load
        .mockResolvedValueOnce(updatedStudies)  // dialog refresh after study-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Initially, no study is selected
      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      expect(studySelect.props('value')).toBeNull()

      // Open the editor
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await flushPromises()

      // Emit study-saved from the editor
      const editor = wrapper.findComponent(StudyEditor)
      await editor.vm.$emit('study-saved', newStudy)
      await flushPromises()

      // AC5: The newly created study should be selected in the job dialog dropdown
      expect(studySelect.props('value')).toBe('preset-new')

      // AC2: The editor modal should be closed
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Studies')
      expect(editorModal!.props('show')).toBe(false)
    })

    it('retains the updated study selection after editing an existing study', async () => {
      const updatedStudy: Study = {
        ...sampleStudies[0],
        name: 'Quick Test Updated',
      }

      mockListStudies
        .mockResolvedValueOnce(sampleStudies)  // initial dialog load
        .mockResolvedValueOnce(sampleStudies)  // StudyEditor own mount load
        .mockResolvedValueOnce([updatedStudy, sampleStudies[1]])  // dialog refresh

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select the study first
      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      studySelect.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Open the editor
      await wrapper.find('[data-testid="manage-studies-button"]').trigger('click')
      await flushPromises()

      // Save the existing study (update)
      const editor = wrapper.findComponent(StudyEditor)
      await editor.vm.$emit('study-saved', updatedStudy)
      await flushPromises()

      // The same study should remain selected
      expect(studySelect.props('value')).toBe('preset-1')

      // The editor should be closed
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Studies')
      expect(editorModal!.props('show')).toBe(false)
    })
  })

  // AC: Clicking Regenerate opens JobLaunchDialog pre-populated with the original job's settings
  describe('regenerate pre-population (prefillJob prop)', () => {
    const completedJob: SampleJob = {
      id: 'job-completed',
      training_run_name: 'qwen/psai4rt-v0.4.0',
      study_id: 'preset-2',
      study_name: 'Full Test',
      workflow_name: 'auraflow-image.json',
      vae: 'ae.safetensors',
      clip: 't5xxl_fp16.safetensors',
      shift: 3.0,
      status: 'completed',
      total_items: 100,
      completed_items: 100,
      failed_items: 0,
      pending_items: 0,
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    }

    const completedWithErrorsJob: SampleJob = {
      id: 'job-errors-prefill',
      training_run_name: 'qwen/psai4rt-v0.4.0',
      study_id: 'preset-1',
      study_name: 'Quick Test',
      workflow_name: 'qwen-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
      status: 'completed_with_errors',
      total_items: 3,
      completed_items: 1,
      failed_items: 2,
      pending_items: 0,
      failed_item_details: [
        { checkpoint_filename: 'chk-a.safetensors', error_message: 'VRAM overflow' },
        { checkpoint_filename: 'chk-c.safetensors', error_message: 'timeout expired' },
      ],
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    }

    // AC: Dialog is pre-populated with training run from the job
    it('pre-selects the training run matching the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      // runWithSamples (id=2) has name 'qwen/psai4rt-v0.4.0'
      expect(runSelect.props('value')).toBe(2)
    })

    // AC: Dialog is pre-populated with workflow from the job
    it('pre-selects the workflow from the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('auraflow-image.json')
    })

    // AC: Dialog is pre-populated with study from the job
    it('pre-selects the study from the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      expect(studySelect.props('value')).toBe('preset-2')
    })

    // AC: Dialog is pre-populated with VAE from the job
    it('pre-selects the VAE from the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const vaeSelect = wrapper.find('[data-testid="vae-select"]').findComponent(NSelect)
      expect(vaeSelect.props('value')).toBe('ae.safetensors')
    })

    // AC: Dialog is pre-populated with CLIP from the job
    it('pre-selects the CLIP from the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const clipSelect = wrapper.find('[data-testid="clip-select"]').findComponent(NSelect)
      expect(clipSelect.props('value')).toBe('t5xxl_fp16.safetensors')
    })

    // AC: Dialog is pre-populated with shift from the job
    it('pre-selects the shift value from the job', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const shiftInput = wrapper.find('[data-testid="shift-input"]').findComponent(NInputNumber)
      expect(shiftInput.props('value')).toBe(3.0)
    })

    // AC: Expands the "show all" filter when the training run is not in the default filter
    it('expands the show-all filter for runs with samples', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)
    })

    // AC: For completed_with_errors jobs, failed checkpoints are pre-selected
    it('pre-selects only failed checkpoints for completed_with_errors jobs', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedWithErrorsJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // chk-a and chk-c failed, chk-b did not
      const chkA = wrapper.find('[data-testid="checkpoint-row-chk-a.safetensors"]').findComponent(NCheckbox)
      expect(chkA.props('checked')).toBe(true)

      const chkB = wrapper.find('[data-testid="checkpoint-row-chk-b.safetensors"]').findComponent(NCheckbox)
      expect(chkB.props('checked')).toBe(false)

      const chkC = wrapper.find('[data-testid="checkpoint-row-chk-c.safetensors"]').findComponent(NCheckbox)
      expect(chkC.props('checked')).toBe(true)
    })

    // AC: For completed jobs, all checkpoints are pre-selected
    it('pre-selects all checkpoints for completed jobs', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const chkA = wrapper.find('[data-testid="checkpoint-row-chk-a.safetensors"]').findComponent(NCheckbox)
      expect(chkA.props('checked')).toBe(true)

      const chkB = wrapper.find('[data-testid="checkpoint-row-chk-b.safetensors"]').findComponent(NCheckbox)
      expect(chkB.props('checked')).toBe(true)

      const chkC = wrapper.find('[data-testid="checkpoint-row-chk-c.safetensors"]').findComponent(NCheckbox)
      expect(chkC.props('checked')).toBe(true)
    })

    // AC: The regenerated job is a new job (uses standard create flow)
    it('submits a new job using the standard createSampleJob API', async () => {
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-new',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-2', study_name: 'Full Test',
        workflow_name: 'auraflow-image.json',
        status: 'pending',
        total_items: 3,
        completed_items: 0,
        failed_items: 0,
        pending_items: 3,
        created_at: '2025-01-03T00:00:00Z',
        updated_at: '2025-01-03T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // All fields should be pre-filled, so submit should be enabled
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      expect(submitButton).toBeDefined()
      expect(submitButton!.props('disabled')).toBe(false)

      await submitButton!.trigger('click')
      await flushPromises()

      // Verify the standard createSampleJob API was called
      expect(mockCreateSampleJob).toHaveBeenCalledTimes(1)
      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.training_run_name).toBe('qwen/psai4rt-v0.4.0')
      expect(call.study_id).toBe('preset-2')
      expect(call.workflow_name).toBe('auraflow-image.json')
      expect(call.vae).toBe('ae.safetensors')
      expect(call.clip).toBe('t5xxl_fp16.safetensors')
      expect(call.shift).toBe(3.0)
    })

    // AC: Prefill skips auto-selection (does not use auto-selected single workflow)
    it('uses prefill workflow instead of auto-selected single workflow', async () => {
      // Only one valid workflow remains: qwen-image.json
      // But prefill job uses auraflow-image.json — prefill must win
      const singleValidWorkflows: WorkflowSummary[] = [
        {
          name: 'auraflow-image.json',
          validation_state: 'valid',
          roles: { save_image: ['9'], unet_loader: ['4'], shift: ['3'] },
          warnings: [],
        },
      ]
      mockListWorkflows.mockResolvedValue(singleValidWorkflows)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      // Prefill sets workflow from the job, not from auto-selection logic
      expect(workflowSelect.props('value')).toBe('auraflow-image.json')
    })

    // AC: Prefill skips persistence restoration (does not use localStorage values)
    it('uses prefill values instead of localStorage persistence', async () => {
      // Set up localStorage with different values
      const state: GenerateInputsState = {
        lastWorkflowId: 'qwen-image.json',
        lastTrainingRunId: 1,
        lastStudyId: 'preset-1',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true, prefillJob: completedJob },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Should use prefill values, not localStorage values
      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBe(2) // Not 1 from localStorage

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('auraflow-image.json') // Not 'qwen-image.json' from localStorage

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      expect(studySelect.props('value')).toBe('preset-2') // Not 'preset-1' from localStorage
    })
  })

  // AC1 + AC2 + AC3: Single-workflow auto-selection
  describe('single-workflow auto-selection (AC1/AC2/AC3)', () => {
    // AC1: When exactly one valid workflow exists, it is auto-selected on mount.
    it('auto-selects the workflow when exactly one valid workflow is available', async () => {
      const singleWorkflow: WorkflowSummary[] = [
        {
          name: 'qwen-image.json',
          validation_state: 'valid',
          roles: { save_image: ['9'], unet_loader: ['4'] },
          warnings: [],
        },
      ]
      mockListWorkflows.mockResolvedValue(singleWorkflow)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // AC1: The sole valid workflow should be auto-selected
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('qwen-image.json')
    })

    // AC1: Only valid workflows count — invalid workflows are excluded from the single-workflow check.
    it('auto-selects the single valid workflow even when invalid workflows are present', async () => {
      const mixedWorkflows: WorkflowSummary[] = [
        {
          name: 'valid-only.json',
          validation_state: 'valid',
          roles: { save_image: ['9'], unet_loader: ['4'] },
          warnings: [],
        },
        {
          name: 'broken.json',
          validation_state: 'invalid',
          roles: {},
          warnings: ['Missing required roles'],
        },
      ]
      mockListWorkflows.mockResolvedValue(mixedWorkflows)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // AC1: 'valid-only.json' is the sole valid workflow and should be auto-selected
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('valid-only.json')
    })

    // AC2: When multiple valid workflows exist, the last-used workflow is restored from localStorage.
    it('restores last-used workflow from localStorage when multiple valid workflows exist', async () => {
      // sampleWorkflows has two valid workflows: qwen-image.json and auraflow-image.json
      // (default mock already sets this up)
      const state: GenerateInputsState = {
        lastWorkflowId: 'auraflow-image.json',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // AC2: Last-used workflow from localStorage should be restored
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('auraflow-image.json')
    })

    // AC2: When multiple valid workflows exist and no localStorage value, no workflow is pre-selected.
    it('does not auto-select any workflow when multiple valid workflows exist and no localStorage value', async () => {
      // sampleWorkflows has two valid workflows and localStorage is empty
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // AC2: No auto-selection when multiple valid workflows exist
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBeNull()
    })

    // AC3: Auto-selection does not override an explicit user selection made after mount.
    it('does not override a user-selected workflow when only one valid workflow was auto-selected', async () => {
      // Start with one valid workflow so auto-selection fires
      const singleWorkflow: WorkflowSummary[] = [
        {
          name: 'qwen-image.json',
          validation_state: 'valid',
          roles: { save_image: ['9'], unet_loader: ['4'] },
          warnings: [],
        },
      ]
      mockListWorkflows.mockResolvedValue(singleWorkflow)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Auto-selected on mount
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('qwen-image.json')

      // AC3: User explicitly clears the selection — this should stick
      workflowSelect.vm.$emit('update:value', null)
      await nextTick()

      expect(workflowSelect.props('value')).toBeNull()
    })

    // AC1: When zero valid workflows exist, no auto-selection occurs.
    it('does not auto-select when no valid workflows are available', async () => {
      mockListWorkflows.mockResolvedValue([
        {
          name: 'broken.json',
          validation_state: 'invalid' as const,
          roles: {},
          warnings: ['Missing required roles'],
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBeNull()
    })

    // AC3: Auto-selection does not override a restored localStorage value in the single-workflow case.
    // When localStorage holds the same workflow name, the result is identical (no conflict).
    // When localStorage holds a different name that is no longer valid, single-workflow auto-select fires.
    it('auto-selects single workflow even when localStorage has a stale (now invalid) workflow', async () => {
      const singleWorkflow: WorkflowSummary[] = [
        {
          name: 'new-workflow.json',
          validation_state: 'valid',
          roles: { save_image: ['9'], unet_loader: ['4'] },
          warnings: [],
        },
      ]
      mockListWorkflows.mockResolvedValue(singleWorkflow)

      // localStorage has a stale workflow that is no longer available
      const state: GenerateInputsState = {
        lastWorkflowId: 'old-deleted-workflow.json',
        byModelType: {},
      }
      localStorage.setItem(GENERATE_INPUTS_STORAGE_KEY, JSON.stringify(state))

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // AC1: Single-workflow auto-select should fire since only one valid workflow exists
      const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
      expect(workflowSelect.props('value')).toBe('new-workflow.json')
    })
  })

  // S-084: Validation preview and Generate Missing Samples
  describe('validation preview (S-084)', () => {
    it('does not fetch validation when only training run is selected (no study)', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()
      mockValidateTrainingRun.mockClear()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      expect(mockValidateTrainingRun).not.toHaveBeenCalled()
    })

    it('calls validateTrainingRun when both training run and study are selected', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'checkpoint1.safetensors', expected: 1, verified: 1, missing: 0 },
          { checkpoint: 'checkpoint2.safetensors', expected: 1, verified: 0, missing: 1 },
        ],
        expected_per_checkpoint: 1,
        total_expected: 2,
        total_verified: 1,
        total_actual: 1,
        total_missing: 1,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run and study
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(mockValidateTrainingRun).toHaveBeenCalledWith(1, 'preset-1')
    })

    // AC: Validation results now appear as per-checkpoint rows with found/expected counts
    it('displays per-checkpoint validation status with sample counts', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'checkpoint1.safetensors', expected: 10, verified: 8, missing: 2 },
          { checkpoint: 'checkpoint2.safetensors', expected: 10, verified: 10, missing: 0 },
        ],
        expected_per_checkpoint: 10,
        total_expected: 20,
        total_verified: 18,
        total_actual: 18,
        total_missing: 2,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // Checkpoint picker section should be visible (replaces old validation-preview)
      const picker = wrapper.find('[data-testid="checkpoint-picker"]')
      expect(picker.exists()).toBe(true)

      // Validation totals summary
      const totals = wrapper.find('[data-testid="validation-totals"]')
      expect(totals.exists()).toBe(true)
      expect(totals.text()).toContain('18 / 20 samples')
      expect(totals.text()).toContain('2 missing')

      // Per-checkpoint validation rows with counts
      const results = wrapper.find('[data-testid="validation-results"]')
      expect(results.exists()).toBe(true)
      expect(results.text()).toContain('checkpoint1.safetensors')
      expect(results.text()).toContain('8/10')
      expect(results.text()).toContain('checkpoint2.safetensors')
      expect(results.text()).toContain('10/10')
    })

    it('does not show checkpoint picker when no training run is selected', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    // AC: Warning icons shown on checkpoints with missing samples
    it('shows warning icons on checkpoints with missing samples', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'checkpoint1.safetensors', expected: 10, verified: 8, missing: 2 },
        ],
        expected_per_checkpoint: 10,
        total_expected: 10,
        total_verified: 8,
        total_actual: 8,
        total_missing: 2,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // The checkpoint row should have a warning class
      const row = wrapper.find('[data-testid="checkpoint-row-checkpoint1.safetensors"]')
      expect(row.exists()).toBe(true)
      expect(row.classes()).toContain('checkpoint-row--warning')
    })

    // AC: "Select Missing" button replaces the old "Generate Missing Samples" button
    it('shows "Select Missing" button when validation finds missing samples (for runs with samples)', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'chk-a.safetensors', expected: 1, verified: 1, missing: 0 },
          { checkpoint: 'chk-b.safetensors', expected: 1, verified: 0, missing: 1 },
          { checkpoint: 'chk-c.safetensors', expected: 1, verified: 1, missing: 0 },
        ],
        expected_per_checkpoint: 1,
        total_expected: 3,
        total_verified: 2,
        total_actual: 2,
        total_missing: 1,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select run with samples
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="select-missing-checkpoints"]').exists()).toBe(true)
    })

    // B-049: "Select Missing" button must not appear when zero samples exist (total_actual=0)
    it('does not show "Select Missing" button when total_actual is 0 even if checkpoints have missing > 0', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'chk-a.safetensors', expected: 2, verified: 0, missing: 2 },
          { checkpoint: 'chk-b.safetensors', expected: 2, verified: 0, missing: 2 },
          { checkpoint: 'chk-c.safetensors', expected: 2, verified: 0, missing: 2 },
        ],
        expected_per_checkpoint: 2,
        total_expected: 6,
        total_verified: 0,
        total_actual: 0,
        total_missing: 6,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select run with samples (to show checkpoint picker)
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // "Select Missing" should NOT be shown because no samples exist at all
      expect(wrapper.find('[data-testid="select-missing-checkpoints"]').exists()).toBe(false)
    })

    it('does not show "Select Missing" button when all samples are present', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'chk-a.safetensors', expected: 1, verified: 1, missing: 0 },
          { checkpoint: 'chk-b.safetensors', expected: 1, verified: 1, missing: 0 },
          { checkpoint: 'chk-c.safetensors', expected: 1, verified: 1, missing: 0 },
        ],
        expected_per_checkpoint: 1,
        total_expected: 3,
        total_verified: 3,
        total_actual: 3,
        total_missing: 0,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="select-missing-checkpoints"]').exists()).toBe(false)
    })

    it('clicking "Select Missing" selects only incomplete checkpoints and disables clearExisting', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'chk-a.safetensors', expected: 48, verified: 48, missing: 0 },
          { checkpoint: 'chk-b.safetensors', expected: 48, verified: 0, missing: 48 },
          { checkpoint: 'chk-c.safetensors', expected: 48, verified: 20, missing: 28 },
        ],
        expected_per_checkpoint: 48,
        total_expected: 144,
        total_verified: 68,
        total_actual: 68,
        total_missing: 76,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run with samples (triggers checkpoint picker)
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
      await flushPromises()

      // Click "Select Missing"
      await wrapper.find('[data-testid="select-missing-checkpoints"]').trigger('click')
      await nextTick()

      // Only checkpoints with missing > 0 should be selected (chk-b, chk-c)
      const chkA = wrapper.find('[data-testid="checkpoint-row-chk-a.safetensors"]').findComponent(NCheckbox)
      expect(chkA.props('checked')).toBe(false)

      const chkB = wrapper.find('[data-testid="checkpoint-row-chk-b.safetensors"]').findComponent(NCheckbox)
      expect(chkB.props('checked')).toBe(true)

      const chkC = wrapper.find('[data-testid="checkpoint-row-chk-c.safetensors"]').findComponent(NCheckbox)
      expect(chkC.props('checked')).toBe(true)

      // clearExisting should be false (we want to keep existing samples and add missing ones)
      const clearExistingCheckbox = wrapper.find('[data-testid="clear-existing-checkbox"]').findComponent(NCheckbox)
      expect(clearExistingCheckbox.props('checked')).toBe(false)
    })

    it('does not show checkpoint picker when only training run is selected (no study)', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    it('does not show missing count in totals when all samples are present', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'checkpoint1.safetensors', expected: 10, verified: 10, missing: 0 },
        ],
        expected_per_checkpoint: 10,
        total_expected: 10,
        total_verified: 10,
        total_actual: 10,
        total_missing: 0,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      const totals = wrapper.find('[data-testid="validation-totals"]')
      expect(totals.exists()).toBe(true)
      expect(totals.text()).toContain('10 / 10 samples')
      expect(totals.text()).not.toContain('missing')
    })

    it('clears checkpoint picker when training run is deselected', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'checkpoint1.safetensors', expected: 1, verified: 1, missing: 0 },
        ],
        expected_per_checkpoint: 1,
        total_expected: 1,
        total_verified: 1,
        total_actual: 1,
        total_missing: 0,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run and study to trigger validation
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(true)

      // Deselect training run
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', null)
      await flushPromises()

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    it('clears previous validation result when training run changes and shows loading state', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [],
        expected_per_checkpoint: 0,
        total_expected: 10,
        total_verified: 10,
        total_actual: 10,
        total_missing: 0,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run and study to trigger validation
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()
      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(true)

      // Now the mock returns a never-resolving promise for the new validation request
      mockValidateTrainingRun.mockReturnValue(new Promise(() => {}))

      // Switch to a different training run — validationResult clears but validation re-triggers
      // since the study is still selected. The checkpoint picker shows loading state.
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()

      // Checkpoint picker should show loading state (validating = true), not the old results
      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(true)
      expect(wrapper.find('.validation-loading').exists()).toBe(true)
    })

    it('handles validation API error gracefully (no checkpoint picker shown)', async () => {
      mockValidateTrainingRun.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'fail' })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // Should not show checkpoint picker when validation fails
      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    it('re-triggers validation when study selection changes', async () => {
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [],
        expected_per_checkpoint: 1,
        total_expected: 1,
        total_verified: 1,
        total_actual: 1,
        total_missing: 0,
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run and first study
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await nextTick()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(mockValidateTrainingRun).toHaveBeenCalledWith(1, 'preset-1')

      // Change study
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
      await flushPromises()

      expect(mockValidateTrainingRun).toHaveBeenCalledWith(1, 'preset-2')
    })
  })

  describe('missing-only generation (S-084 AC4)', () => {
    it('shows missing-only checkbox when run has samples and validation is complete', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="missing-only-checkbox"]').exists()).toBe(true)
    })

    it('does not show missing-only checkbox for empty runs', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunEmpty)
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      expect(wrapper.find('[data-testid="missing-only-checkbox"]').exists()).toBe(false)
    })

    it('disables clear_existing checkbox when missing-only is checked', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // Enable missing-only
      wrapper.find('[data-testid="missing-only-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      const clearExistingCheckbox = wrapper.find('[data-testid="clear-existing-checkbox"]').findComponent(NCheckbox)
      expect(clearExistingCheckbox.props('disabled')).toBe(true)
    })

    it('unchecks clear_existing when missing-only is enabled', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // clear_existing should be auto-enabled for runs with samples
      const clearExistingCheckbox = wrapper.find('[data-testid="clear-existing-checkbox"]').findComponent(NCheckbox)
      expect(clearExistingCheckbox.props('checked')).toBe(true)

      // Enable missing-only — should uncheck clear_existing
      wrapper.find('[data-testid="missing-only-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      expect(clearExistingCheckbox.props('checked')).toBe(false)
    })

    it('sends missing_only in payload when checkbox is checked', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-missing',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 2,
        completed_items: 0,
        failed_items: 0,
        pending_items: 2,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      // Enable missing-only
      wrapper.find('[data-testid="missing-only-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()

      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.missing_only).toBe(true)
      // clear_existing should not be set when missing_only is true
      expect(call.clear_existing).toBeUndefined()
    })

    it('does not send missing_only when checkbox is not checked', async () => {
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-normal',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 3,
        completed_items: 0,
        failed_items: 0,
        pending_items: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.missing_only).toBeUndefined()
      expect(call.clear_existing).toBe(true)
    })
  })

  // S-086: Study selector UX and sample availability beads
  describe('study selector and availability beads (S-086)', () => {
    // AC1: Study selection is required before showing the checkpoint picker
    it('does not show checkpoint picker when study is not selected even if run has samples', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select run with samples
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      // No study selected — checkpoint picker should not be visible
      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(false)
    })

    // AC2: Green bead when study has complete samples for the selected training run
    it('renders correct _sampleStatus for studies with complete, partial and no samples', async () => {
      mockGetStudyAvailability.mockResolvedValue([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: false,
          sample_status: 'none',
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a training run to trigger availability fetch
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string; _sampleStatus: string }>

      const quickTest = options.find(o => o.value === 'preset-1')
      expect(quickTest?._sampleStatus).toBe('complete')

      const fullTest = options.find(o => o.value === 'preset-2')
      expect(fullTest?._sampleStatus).toBe('none')
    })

    it('sets renderLabel on the study select for bead rendering', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      expect(typeof studySelect.props('renderLabel')).toBe('function')
    })

    it('renderStudyLabel returns VNode with bead for complete status option', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const renderLabel = studySelect.props('renderLabel') as (option: Record<string, unknown>) => VNode

      const vnode = renderLabel({
        label: 'Test Study',
        value: 'test-id',
        _sampleStatus: 'complete',
        _hasAvailability: true,
      })

      expect(vnode).toBeTruthy()
      const children = (vnode as { children?: unknown[] }).children
      expect(Array.isArray(children)).toBe(true)
      // Complete status: bead + label = 2 children
      expect((children as unknown[]).length).toBe(2)
    })

    // Study labels show just the study name (immutability model — no versioning)
    it('shows study name as label in the study selector', async () => {
      mockGetStudyAvailability.mockResolvedValue([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: false,
          sample_status: 'none',
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a training run to trigger availability fetch
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string }>

      expect(options.find(o => o.value === 'preset-1')?.label).toBe('Quick Test')
      expect(options.find(o => o.value === 'preset-2')?.label).toBe('Full Test')
    })

    it('shows study name when no availability data exists', async () => {
      // Default mock returns empty array for availability
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string }>

      expect(options.find(o => o.value === 'preset-1')?.label).toBe('Quick Test')
      expect(options.find(o => o.value === 'preset-2')?.label).toBe('Full Test')
    })

    it('fetches study availability when a training run is selected', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      expect(mockGetStudyAvailability).toHaveBeenCalledWith(1)
    })

    it('clears study availability when training run is deselected', async () => {
      mockGetStudyAvailability.mockResolvedValue([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select training run to trigger availability fetch
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      let options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ label: string; value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('complete')

      // Deselect training run
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', null)
      await flushPromises()

      options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ label: string; value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('none')
    })

    it('handles study availability API failure gracefully', async () => {
      mockGetStudyAvailability.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'fail' })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      // Should not crash — study options still display without beads
      const options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ label: string; value: string; _sampleStatus: string }>
      expect(options).toHaveLength(2)
      expect(options[0]._sampleStatus).toBe('none')
    })
  })

  // S-088: Study dropdown status beads — green for complete, yellow for partial, none for no samples
  describe('study dropdown status beads (S-088)', () => {
    it('study options use _sampleStatus field from availability data', async () => {
      mockGetStudyAvailability.mockResolvedValue([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: true,
          sample_status: 'partial',
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string; _sampleStatus: string }>

      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('complete')
      expect(options.find(o => o.value === 'preset-2')?._sampleStatus).toBe('partial')
    })

    it('renderStudyLabel renders green bead for complete status', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const renderLabel = studySelect.props('renderLabel') as (option: Record<string, unknown>) => VNode

      const vnode = renderLabel({
        label: 'Complete Study',
        value: 's1',
        _sampleStatus: 'complete',
        _hasAvailability: true,
      })

      // Should have 2 children: bead + label text
      const children = (vnode as { children?: unknown[] }).children as unknown[]
      expect(children).toHaveLength(2)

      // The first child is the bead span
      const beadSpan = children[0] as { props?: { style?: { backgroundColor?: string } } }
      expect(beadSpan.props?.style?.backgroundColor).toBe('#18a058')
    })

    it('renderStudyLabel renders yellow bead for partial status', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const renderLabel = studySelect.props('renderLabel') as (option: Record<string, unknown>) => VNode

      const vnode = renderLabel({
        label: 'Partial Study',
        value: 's2',
        _sampleStatus: 'partial',
        _hasAvailability: true,
      })

      // Should have 2 children: bead + label text
      const children = (vnode as { children?: unknown[] }).children as unknown[]
      expect(children).toHaveLength(2)

      // The first child is the bead span with yellow color
      const beadSpan = children[0] as { props?: { style?: { backgroundColor?: string } } }
      expect(beadSpan.props?.style?.backgroundColor).toBe('#f0a020')
    })

    it('renderStudyLabel renders no bead for none status', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const renderLabel = studySelect.props('renderLabel') as (option: Record<string, unknown>) => VNode

      const vnode = renderLabel({
        label: 'Empty Study',
        value: 's3',
        _sampleStatus: 'none',
        _hasAvailability: false,
      })

      // Should have only 1 child: just the label text (no bead)
      const children = (vnode as { children?: unknown[] }).children as unknown[]
      expect(children).toHaveLength(1)
    })

    it('study options default to _sampleStatus none when no availability data', async () => {
      // Default mock: availability is empty
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const studySelect = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
      const options = studySelect.props('options') as Array<{ label: string; value: string; _sampleStatus: string }>

      // Both studies should default to 'none' when no availability info
      for (const opt of options) {
        expect(opt._sampleStatus).toBe('none')
      }
    })

    it('beads update when training run selection changes', async () => {
      // First training run has complete samples for preset-1
      mockGetStudyAvailability.mockResolvedValueOnce([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: false,
          sample_status: 'none',
        },
      ])
      // Second training run has only partial for preset-1
      mockGetStudyAvailability.mockResolvedValueOnce([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'partial',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: true,
          sample_status: 'complete',
        },
      ])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select first training run
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()

      let options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('complete')
      expect(options.find(o => o.value === 'preset-2')?._sampleStatus).toBe('none')

      // Switch to second training run
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('partial')
      expect(options.find(o => o.value === 'preset-2')?._sampleStatus).toBe('complete')
    })

    // B-062: Study bead overrides directory-level status with validation results
    it('overrides study bead to partial when validation shows missing images', async () => {
      // Backend availability says 'complete' (directory-level check), but validation shows missing images
      mockGetStudyAvailability.mockResolvedValue([
        {
          study_id: 'preset-1',
          study_name: 'Quick Test',
          has_samples: true,
          sample_status: 'complete',
        },
        {
          study_id: 'preset-2',
          study_name: 'Full Test',
          has_samples: false,
          sample_status: 'none',
        },
      ])
      // Validation result shows missing samples (590/684 scenario)
      mockValidateTrainingRun.mockResolvedValue({
        checkpoints: [
          { checkpoint: 'chk-a.safetensors', expected: 228, verified: 200, missing: 28 },
          { checkpoint: 'chk-b.safetensors', expected: 228, verified: 195, missing: 33 },
          { checkpoint: 'chk-c.safetensors', expected: 228, verified: 195, missing: 33 },
        ],
        expected_per_checkpoint: 228,
        total_expected: 684,
        total_verified: 590,
        total_actual: 590,
        total_missing: 94,
      })
      // Completed job so the training run shows as having samples
      mockListSampleJobs.mockResolvedValue([{
        id: 'job-1',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        vae: 'ae.safetensors', clip: 'clip_l.safetensors',
        status: 'completed',
        total_items: 684, completed_items: 684, failed_items: 0, pending_items: 0,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
      }])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select the training run
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      // Before study selection: availability says 'complete'
      let options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('complete')

      // Select the study to trigger validation
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // After validation: should override to 'partial' because total_missing > 0
      options = wrapper.find('[data-testid="study-select"]').findComponent(NSelect)
        .props('options') as Array<{ value: string; _sampleStatus: string }>
      expect(options.find(o => o.value === 'preset-1')?._sampleStatus).toBe('partial')
      // Non-selected study remains unchanged
      expect(options.find(o => o.value === 'preset-2')?._sampleStatus).toBe('none')
    })
  })

  // B-062: Training run bead shows correct color with study-scoped samples
  describe('training run bead with study-scoped samples (B-062)', () => {
    // Training run with has_samples: false (study-scoped directories not found at root level)
    // but with a completed job
    it('shows green bead for completed job even when has_samples is false', async () => {
      mockListSampleJobs.mockResolvedValue([{
        id: 'job-done',
        training_run_name: 'qwen/psai4rt-v0.3.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        vae: 'ae.safetensors', clip: 'clip_l.safetensors',
        status: 'completed',
        total_items: 10, completed_items: 10, failed_items: 0, pending_items: 0,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
      }])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number; _status: string; _color: string }>
      // runEmpty (id=1) has_samples: false but has a completed job → should be green (complete)
      const opt = options.find(o => o.value === 1)
      expect(opt?._status).toBe('complete')
      expect(opt?._color).toBe('#18a058')
    })

    it('shows yellow bead for completed_with_errors job even when has_samples is false', async () => {
      mockListSampleJobs.mockResolvedValue([{
        id: 'job-partial',
        training_run_name: 'qwen/psai4rt-v0.3.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        vae: 'ae.safetensors', clip: 'clip_l.safetensors',
        status: 'completed_with_errors',
        total_items: 10, completed_items: 7, failed_items: 3, pending_items: 0,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
      }])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number; _status: string; _color: string }>
      // runEmpty (id=1) has_samples: false but has a completed_with_errors job → should be yellow (partial)
      const opt = options.find(o => o.value === 1)
      expect(opt?._status).toBe('partial')
      expect(opt?._color).toBe('#f0a020')
    })

    it('shows checkboxes for run with completed job even when has_samples is false', async () => {
      // Completed job for the empty run (has_samples: false, but has completed job)
      mockListSampleJobs.mockResolvedValue([{
        id: 'job-done',
        training_run_name: 'qwen/psai4rt-v0.3.0',
        study_id: 'preset-1', study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        vae: 'ae.safetensors', clip: 'clip_l.safetensors',
        status: 'completed',
        total_items: 10, completed_items: 10, failed_items: 0, pending_items: 0,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
      }])
      mockValidateTrainingRun.mockResolvedValue(validationForRunWithSamples)

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select the run with completed job (has_samples: false)
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      await flushPromises()
      // Select a study so validation triggers
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await flushPromises()

      // AC: checkboxes should appear since the run has samples (from completed job)
      expect(wrapper.find('[data-testid="clear-existing-checkbox"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="missing-only-checkbox"]').exists()).toBe(true)
    })
  })

  // S-093: Confirmation dialog for regenerating a fully-validated sample set
  describe('regeneration confirmation dialog (S-093)', () => {
    // Validation result where ALL expected samples exist (complete = no missing)
    const validationComplete = {
      checkpoints: [
        { checkpoint: 'chk-a.safetensors', expected: 1, verified: 1, missing: 0 },
        { checkpoint: 'chk-b.safetensors', expected: 1, verified: 1, missing: 0 },
        { checkpoint: 'chk-c.safetensors', expected: 1, verified: 1, missing: 0 },
      ],
      expected_per_checkpoint: 1,
      total_expected: 3,
      total_verified: 3,
      total_actual: 3,
      total_missing: 0,
    }

    // Validation result with some missing samples (incomplete)
    const validationIncomplete = {
      checkpoints: [
        { checkpoint: 'chk-a.safetensors', expected: 1, verified: 1, missing: 0 },
        { checkpoint: 'chk-b.safetensors', expected: 1, verified: 0, missing: 1 },
        { checkpoint: 'chk-c.safetensors', expected: 1, verified: 1, missing: 0 },
      ],
      expected_per_checkpoint: 1,
      total_expected: 3,
      total_verified: 2,
      total_actual: 2,
      total_missing: 1,
    }

    /** Helper to set up the dialog with a run-with-samples selected + all form fields filled. */
    async function mountAndFillRunWithSamples(validationResult: typeof validationComplete) {
      mockValidateTrainingRun.mockResolvedValue(validationResult)
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-regen',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1',
        study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 3,
        completed_items: 0,
        failed_items: 0,
        pending_items: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      return wrapper
    }

    // AC1: Clicking Regenerate on a validated (complete) sample set shows the confirmation dialog
    it('shows confirmation dialog when all expected samples exist (complete validation)', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationComplete)

      // Confirmation dialog should be hidden initially
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      expect(confirmDialog).toBeDefined()
      expect(confirmDialog!.props('show')).toBe(false)

      // Click "Regenerate Samples"
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // AC1: Confirmation dialog must appear
      const updatedDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      expect(updatedDialog!.props('show')).toBe(true)

      // No API call made yet (dialog shown, not submitted)
      expect(mockCreateSampleJob).not.toHaveBeenCalled()
    })

    // AC2: Dialog explains that all expected samples already exist and regeneration will overwrite them
    it('shows explanation text in confirmation dialog', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationComplete)

      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // AC2: Description must mention samples already exist and overwrite
      const description = wrapper.find('[data-testid="confirm-regen-description"]')
      expect(description.exists()).toBe(true)
      expect(description.text()).toContain('All expected samples already exist')
      expect(description.text()).toContain('overwrite')
    })

    // AC3: Confirm proceeds with regeneration
    it('proceeds with job creation when Confirm button is clicked', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationComplete)

      // Open the confirmation dialog
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // Click the confirm button
      const confirmButton = wrapper.find('[data-testid="confirm-regen-button"]')
      await confirmButton.trigger('click')
      await flushPromises()

      // AC3: Job creation API must have been called
      expect(mockCreateSampleJob).toHaveBeenCalledTimes(1)
      const call = mockCreateSampleJob.mock.calls[0][0]
      expect(call.training_run_name).toBe('qwen/psai4rt-v0.4.0')
    })

    // AC3: Cancel aborts the operation
    it('does not create a job when Cancel button is clicked', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationComplete)

      // Open the confirmation dialog
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // Click Cancel
      const cancelButton = wrapper.find('[data-testid="confirm-regen-cancel-button"]')
      await cancelButton.trigger('click')
      await nextTick()

      // AC3: No job creation
      expect(mockCreateSampleJob).not.toHaveBeenCalled()

      // Confirmation dialog should be closed
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      expect(confirmDialog!.props('show')).toBe(false)
    })

    // AC4: No confirmation dialog when the sample set has missing samples (incomplete validation)
    it('does not show confirmation dialog when some samples are missing (incomplete validation)', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationIncomplete)

      // Click "Regenerate Samples" — should proceed directly without showing dialog
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      // AC4: No confirmation dialog shown
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      // Dialog either doesn't exist or its show prop is false
      if (confirmDialog) {
        expect(confirmDialog.props('show')).toBe(false)
      }

      // Job creation should have been called directly
      expect(mockCreateSampleJob).toHaveBeenCalledTimes(1)
    })

    // AC4: No confirmation for runs with NO samples at all (total_actual = 0)
    it('does not show confirmation dialog when no samples exist at all (total_actual = 0)', async () => {
      // Use the empty run (id=1, no has_samples) — no confirmation ever needed for generate-from-scratch
      mockValidateTrainingRun.mockResolvedValue(validationForRunEmpty)
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-gen',
        training_run_name: 'qwen/psai4rt-v0.3.0',
        study_id: 'preset-1',
        study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 5,
        completed_items: 0,
        failed_items: 0,
        pending_items: 5,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 1)
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await flushPromises()

      // Click "Generate Samples" (not Regenerate — empty run)
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Generate Samples')
      await submitButton!.trigger('click')
      await flushPromises()

      // No confirmation dialog
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      if (confirmDialog) {
        expect(confirmDialog.props('show')).toBe(false)
      }

      // Job created directly
      expect(mockCreateSampleJob).toHaveBeenCalledTimes(1)
    })

    // AC3: Closing the confirmation dialog via mask (update:show=false) is treated as cancel
    it('treats dialog mask-close as cancel (no job creation)', async () => {
      const wrapper = await mountAndFillRunWithSamples(validationComplete)

      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // Simulate mask close (update:show emitted with false)
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      confirmDialog!.vm.$emit('update:show', false)
      await nextTick()

      expect(mockCreateSampleJob).not.toHaveBeenCalled()

      const updatedDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      expect(updatedDialog!.props('show')).toBe(false)
    })

    // AC1 (race condition): Clicking Regenerate before validation returns still shows the
    // confirmation dialog. This covers the UAT-reported bug where clicking quickly after
    // the dialog opened bypassed the dialog (validationResult was null at submit time).
    it('shows confirmation dialog when validation has not yet returned (validationResult is null)', async () => {
      // Make validateTrainingRun return a promise that never resolves, simulating slow network.
      // This means validationResult.value stays null when the user clicks submit.
      mockValidateTrainingRun.mockReturnValue(new Promise(() => { /* never resolves */ }))
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-regen-race',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        study_id: 'preset-1',
        study_name: 'Quick Test',
        workflow_name: 'qwen-image.json',
        status: 'pending',
        total_items: 3,
        completed_items: 0,
        failed_items: 0,
        pending_items: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select run-with-samples and fill all required fields
      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      // Do NOT await flushPromises here — this keeps validation in-flight
      wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
      wrapper.find('[data-testid="study-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

      // Click "Regenerate Samples" while validation is still in progress (result is null)
      const buttons = wrapper.findAllComponents(NButton)
      const submitButton = buttons.find(b => b.text() === 'Regenerate Samples')
      await submitButton!.trigger('click')
      await nextTick()

      // AC1: Confirmation dialog must appear even though validation hasn't returned
      const confirmDialog = wrapper.findAllComponents(NModal).find(m => m.props('title') === 'Regenerate All Samples?')
      expect(confirmDialog).toBeDefined()
      expect(confirmDialog!.props('show')).toBe(true)

      // No API call made yet
      expect(mockCreateSampleJob).not.toHaveBeenCalled()
    })
  })
})

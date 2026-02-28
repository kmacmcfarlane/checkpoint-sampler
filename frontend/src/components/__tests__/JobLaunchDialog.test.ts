import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { nextTick, type VNode } from 'vue'
import { NModal, NSelect, NInputNumber, NButton, NCheckbox } from 'naive-ui'
import JobLaunchDialog from '../JobLaunchDialog.vue'
import SamplePresetEditor from '../SamplePresetEditor.vue'
import type { TrainingRun, WorkflowSummary, SamplePreset, SampleJob } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    getTrainingRuns: vi.fn(),
    listSampleJobs: vi.fn(),
    listWorkflows: vi.fn(),
    listSamplePresets: vi.fn(),
    getComfyUIModels: vi.fn(),
    createSampleJob: vi.fn(),
    createSamplePreset: vi.fn(),
    updateSamplePreset: vi.fn(),
    deleteSamplePreset: vi.fn(),
    getCheckpointMetadata: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'
import { GENERATE_INPUTS_STORAGE_KEY } from '../../composables/useGenerateInputsPersistence'
import type { GenerateInputsState } from '../../composables/useGenerateInputsPersistence'

const mockGetTrainingRuns = apiClient.getTrainingRuns as ReturnType<typeof vi.fn>
const mockListSampleJobs = apiClient.listSampleJobs as ReturnType<typeof vi.fn>
const mockListWorkflows = apiClient.listWorkflows as ReturnType<typeof vi.fn>
const mockListSamplePresets = apiClient.listSamplePresets as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>
const mockCreateSampleJob = apiClient.createSampleJob as ReturnType<typeof vi.fn>
const mockGetCheckpointMetadata = apiClient.getCheckpointMetadata as ReturnType<typeof vi.fn>

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

const samplePresets: SamplePreset[] = [
  {
    id: 'preset-1',
    name: 'Quick Test',
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
  sample_preset_id: 'preset-1',
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

enableAutoUnmount(afterEach)

describe('JobLaunchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGetTrainingRuns.mockResolvedValue(allTrainingRuns)
    mockListSampleJobs.mockResolvedValue([runningJob])
    mockListWorkflows.mockResolvedValue(sampleWorkflows)
    mockListSamplePresets.mockResolvedValue(samplePresets)
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'vae') return Promise.resolve({ models: vaeModels })
      if (type === 'clip') return Promise.resolve({ models: clipModels })
      return Promise.resolve({ models: [] })
    })
    // Default: no checkpoint metadata (empty ss_* fields)
    mockGetCheckpointMetadata.mockResolvedValue({ metadata: {} })
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

  it('fetches training runs, jobs, workflows, presets, and ComfyUI models on mount', async () => {
    mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)
    expect(mockListSampleJobs).toHaveBeenCalledTimes(1)
    expect(mockListWorkflows).toHaveBeenCalledTimes(1)
    expect(mockListSamplePresets).toHaveBeenCalledTimes(1)
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

  describe('default filter (only empty runs)', () => {
    it('shows only runs without samples or active jobs by default', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number }>
      // runEmpty (id=1) is gray (no samples, no jobs) — should appear
      // runWithSamples (id=2) is green (has_samples) — hidden by default
      // runRunning (id=3) has a running job — hidden by default
      expect(options).toHaveLength(1)
      expect(options[0].value).toBe(1)
    })

    it('shows all runs when "show all" checkbox is checked', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      checkbox.vm.$emit('update:checked', true)
      await nextTick()

      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      const options = runSelect.props('options') as Array<{ label: string; value: number }>
      expect(options).toHaveLength(3)
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

  it('populates preset select with all presets', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const presetSelect = wrapper.find('[data-testid="preset-select"]')
    const select = presetSelect.findComponent(NSelect)
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

  it('displays confirmation summary with correct values when run and preset selected', async () => {
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

    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
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

    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
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
      sample_preset_id: 'preset-1',
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
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(mockCreateSampleJob).toHaveBeenCalledWith({
      training_run_name: 'qwen/psai4rt-v0.3.0',
      sample_preset_id: 'preset-1',
      workflow_name: 'qwen-image.json',
      vae: 'ae.safetensors',
      clip: 'clip_l.safetensors',
    })
  })

  it('includes shift value in payload when workflow has shift role', async () => {
    const mockJob: SampleJob = {
      id: 'job-1',
      training_run_name: 'qwen/psai4rt-v0.3.0',
      sample_preset_id: 'preset-1',
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
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
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
      sample_preset_id: 'preset-1',
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
      sample_preset_id: 'preset-1',
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
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
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
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to create job')
  })

  it('renders a "Manage Presets" button next to the preset selector', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const manageButton = wrapper.find('[data-testid="manage-presets-button"]')
    expect(manageButton.exists()).toBe(true)
    expect(manageButton.text()).toBe('Manage Presets')
  })

  it('opens the preset editor modal when "Manage Presets" is clicked', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // The preset editor modal should be hidden initially
    const modals = wrapper.findAllComponents(NModal)
    const editorModal = modals.find(m => m.props('title') === 'Manage Sample Presets')
    expect(editorModal).toBeDefined()
    expect(editorModal!.props('show')).toBe(false)

    // Click "Manage Presets"
    await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
    await nextTick()

    const updatedModals = wrapper.findAllComponents(NModal)
    const openedEditorModal = updatedModals.find(m => m.props('title') === 'Manage Sample Presets')
    expect(openedEditorModal!.props('show')).toBe(true)
  })

  it('refreshes preset list and auto-selects preset when preset-saved is emitted from editor', async () => {
    const newPreset: SamplePreset = {
      id: 'preset-new',
      name: 'Newly Created',
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

    const updatedPresets = [...samplePresets, newPreset]
    mockListSamplePresets
      .mockResolvedValueOnce(samplePresets)  // initial dialog load
      .mockResolvedValueOnce(samplePresets)  // SamplePresetEditor own mount load
      .mockResolvedValueOnce(updatedPresets) // dialog refresh after preset-saved

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
    expect((presetSelect.props('options') as Array<{ label: string; value: string }>)).toHaveLength(2)

    await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
    await flushPromises()

    const editor = wrapper.findComponent(SamplePresetEditor)
    await editor.vm.$emit('preset-saved', newPreset)
    await flushPromises()

    const refreshedOptions = presetSelect.props('options') as Array<{ label: string; value: string }>
    expect(refreshedOptions).toHaveLength(3)
    expect(refreshedOptions[2].label).toBe('Newly Created')
    expect(presetSelect.props('value')).toBe('preset-new')
  })

  it('clears selected preset when preset-deleted is emitted for the selected preset', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
    presetSelect.vm.$emit('update:value', 'preset-1')
    await nextTick()

    await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
    await nextTick()

    const presetsWithoutFirst = samplePresets.filter(p => p.id !== 'preset-1')
    mockListSamplePresets.mockResolvedValueOnce(presetsWithoutFirst)

    const editor = wrapper.findComponent(SamplePresetEditor)
    await editor.vm.$emit('preset-deleted', 'preset-1')
    await flushPromises()

    expect(presetSelect.props('value')).toBeNull()

    const refreshedOptions = presetSelect.props('options') as Array<{ label: string; value: string }>
    expect(refreshedOptions).toHaveLength(1)
    expect(refreshedOptions[0].label).toBe('Full Test')
  })

  describe('preset selection sync between parent and sub-dialog', () => {
    // AC: When opening the sub-dialog, the currently selected preset in the parent is pre-selected.
    it('passes the currently selected preset ID as initialPresetId to SamplePresetEditor', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select a preset in the parent dialog
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Open the manage presets sub-dialog
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await nextTick()

      // The SamplePresetEditor should receive the currently selected preset ID
      const editor = wrapper.findComponent(SamplePresetEditor)
      expect(editor.props('initialPresetId')).toBe('preset-1')
    })

    // AC: If no preset is selected in the parent, SamplePresetEditor receives null.
    it('passes null as initialPresetId when no preset is selected in the parent', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Do not select any preset — open the editor directly
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await nextTick()

      const editor = wrapper.findComponent(SamplePresetEditor)
      expect(editor.props('initialPresetId')).toBeNull()
    })

    // AC: initialPresetId updates when the parent's selected preset changes before opening.
    it('passes the updated preset ID when a different preset is selected before opening', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select preset-1 first, then change to preset-2
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      await nextTick()
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-2')
      await nextTick()

      // Open the editor — should reflect the latest selection
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await nextTick()

      const editor = wrapper.findComponent(SamplePresetEditor)
      expect(editor.props('initialPresetId')).toBe('preset-2')
    })

    // AC: After saving a preset in the sub-dialog, parent dropdown reflects the change.
    it('reflects new preset in parent dropdown after preset-saved from sub-dialog', async () => {
      const newPreset: SamplePreset = {
        id: 'preset-new',
        name: 'Synced Preset',
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

      const updatedPresets = [...samplePresets, newPreset]
      mockListSamplePresets
        .mockResolvedValueOnce(samplePresets)  // initial dialog load
        .mockResolvedValueOnce(samplePresets)  // SamplePresetEditor own mount load
        .mockResolvedValueOnce(updatedPresets) // dialog refresh after preset-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await flushPromises()

      // Simulate the sub-dialog saving a new preset
      const editor = wrapper.findComponent(SamplePresetEditor)
      await editor.vm.$emit('preset-saved', newPreset)
      await flushPromises()

      // Parent preset dropdown should now contain the new preset and have it selected
      const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
      const options = presetSelect.props('options') as Array<{ label: string; value: string }>
      expect(options.some(o => o.label === 'Synced Preset')).toBe(true)
      expect(presetSelect.props('value')).toBe('preset-new')
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

    it('shows checkpoint picker when run with samples is selected', async () => {
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

      expect(wrapper.find('[data-testid="checkpoint-picker"]').exists()).toBe(true)
    })

    it('shows "Select All" and "Deselect All" controls in checkpoint picker', async () => {
      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await nextTick()

      expect(wrapper.find('[data-testid="select-all-checkpoints"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="deselect-all-checkpoints"]').exists()).toBe(true)
    })
  })

  describe('payload for regeneration', () => {
    it('sends clear_existing=true when a run with samples is selected', async () => {
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-2',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        sample_preset_id: 'preset-1',
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
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
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
      sample_preset_id: 'preset-1',
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

    it('shows red bead for training run with completed_with_errors jobs', async () => {
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
      expect(errorRunOpt?._status).toBe('complete_with_errors')
      expect(errorRunOpt?._color).toBe('#d03050')
    })

    it('pre-selects only failed checkpoints when completed_with_errors run is selected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])

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

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      // Failed checkpoints should have a 'failed' badge
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-a.safetensors"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-c.safetensors"]').exists()).toBe(true)

      // Non-failed checkpoint should not have a failed badge
      expect(wrapper.find('[data-testid="checkpoint-failed-badge-chk-b.safetensors"]').exists()).toBe(false)
    })

    it('auto-enables clear_existing when failed checkpoints are pre-selected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
      await flushPromises()

      const clearExistingCheckbox = wrapper.find('[data-testid="clear-existing-checkbox"]').findComponent(NCheckbox)
      expect(clearExistingCheckbox.props('checked')).toBe(true)
    })

    it('disables submit when all checkpoints are deselected', async () => {
      mockListSampleJobs.mockResolvedValue([completedWithErrorsJob])

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
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

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
      mockCreateSampleJob.mockResolvedValue({
        id: 'job-regen',
        training_run_name: 'qwen/psai4rt-v0.4.0',
        sample_preset_id: 'preset-1',
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
      wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
      wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
      wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
      await nextTick()

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

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox).vm.$emit('update:checked', true)
      await nextTick()
      wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect).vm.$emit('update:value', 2)
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

  // AC2: Saving a preset in the Manage Presets sub-modal auto-closes the sub-modal
  // and returns focus to the job launch dialog.
  describe('preset editor auto-close on save (AC2)', () => {
    it('closes the preset editor sub-modal after a preset is saved', async () => {
      const savedPreset: SamplePreset = {
        id: 'preset-1',
        name: 'Quick Test Updated',
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

      mockListSamplePresets
        .mockResolvedValueOnce(samplePresets)  // initial dialog load
        .mockResolvedValueOnce(samplePresets)  // SamplePresetEditor own mount load
        .mockResolvedValueOnce(samplePresets)  // dialog refresh after preset-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Open the preset editor
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await flushPromises()

      // Verify the editor is open
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Sample Presets')
      expect(editorModal!.props('show')).toBe(true)

      // Emit preset-saved from the editor
      const editor = wrapper.findComponent(SamplePresetEditor)
      await editor.vm.$emit('preset-saved', savedPreset)
      await flushPromises()

      // The editor modal should be closed
      const updatedModals = wrapper.findAllComponents(NModal)
      const closedEditorModal = updatedModals.find(m => m.props('title') === 'Manage Sample Presets')
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

    it('expands filter to show all runs when restored run is not empty', async () => {
      // runWithSamples (id=2) has status 'complete' — not shown in default filter
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

      // The showAllRuns filter should be enabled so the run is visible in the dropdown
      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(true)

      // And the run should be selected
      const runSelect = wrapper.find('[data-testid="training-run-select"]').findComponent(NSelect)
      expect(runSelect.props('value')).toBe(2)
    })

    it('does not expand filter when restored run is empty (default filter)', async () => {
      // runEmpty (id=1) has status 'empty' — shown in default filter
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

      // The showAllRuns filter should remain off
      const checkbox = wrapper.find('[data-testid="show-all-runs-checkbox"]').findComponent(NCheckbox)
      expect(checkbox.props('checked')).toBe(false)

      // And the run should still be selected
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
      mockGetTrainingRuns.mockClear()
      mockListSampleJobs.mockClear()

      // Simulate a job completion by changing refreshTrigger
      await wrapper.setProps({ refreshTrigger: 1 })
      await flushPromises()

      // fetchTrainingRunsAndJobs should have been called again
      expect(mockGetTrainingRuns).toHaveBeenCalledTimes(1)
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
      mockGetTrainingRuns.mockResolvedValue(allTrainingRuns)
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

  // AC5: After closing the Manage Presets modal, the preset that was last edited
  // is shown as selected in the job dialog dropdown
  describe('preset state persistence after editor close (AC5)', () => {
    it('selects the newly created preset in the job dialog after preset-saved', async () => {
      const newPreset: SamplePreset = {
        id: 'preset-new',
        name: 'Brand New Preset',
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

      const updatedPresets = [...samplePresets, newPreset]
      mockListSamplePresets
        .mockResolvedValueOnce(samplePresets)   // initial dialog load
        .mockResolvedValueOnce(samplePresets)   // SamplePresetEditor own mount load
        .mockResolvedValueOnce(updatedPresets)  // dialog refresh after preset-saved

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Initially, no preset is selected
      const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
      expect(presetSelect.props('value')).toBeNull()

      // Open the editor
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await flushPromises()

      // Emit preset-saved from the editor
      const editor = wrapper.findComponent(SamplePresetEditor)
      await editor.vm.$emit('preset-saved', newPreset)
      await flushPromises()

      // AC5: The newly created preset should be selected in the job dialog dropdown
      expect(presetSelect.props('value')).toBe('preset-new')

      // AC2: The editor modal should be closed
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Sample Presets')
      expect(editorModal!.props('show')).toBe(false)
    })

    it('retains the updated preset selection after editing an existing preset', async () => {
      const updatedPreset: SamplePreset = {
        ...samplePresets[0],
        name: 'Quick Test Updated',
      }

      mockListSamplePresets
        .mockResolvedValueOnce(samplePresets)  // initial dialog load
        .mockResolvedValueOnce(samplePresets)  // SamplePresetEditor own mount load
        .mockResolvedValueOnce([updatedPreset, samplePresets[1]])  // dialog refresh

      const wrapper = mount(JobLaunchDialog, {
        props: { show: true },
        global: { stubs: { Teleport: true } },
      })
      await flushPromises()

      // Select the preset first
      const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
      presetSelect.vm.$emit('update:value', 'preset-1')
      await nextTick()

      // Open the editor
      await wrapper.find('[data-testid="manage-presets-button"]').trigger('click')
      await flushPromises()

      // Save the existing preset (update)
      const editor = wrapper.findComponent(SamplePresetEditor)
      await editor.vm.$emit('preset-saved', updatedPreset)
      await flushPromises()

      // The same preset should remain selected
      expect(presetSelect.props('value')).toBe('preset-1')

      // The editor should be closed
      const modals = wrapper.findAllComponents(NModal)
      const editorModal = modals.find(m => m.props('title') === 'Manage Sample Presets')
      expect(editorModal!.props('show')).toBe(false)
    })
  })
})

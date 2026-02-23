import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NSelect, NInputNumber, NButton } from 'naive-ui'
import JobLaunchDialog from '../JobLaunchDialog.vue'
import type { TrainingRun, WorkflowSummary, SamplePreset, SampleJob } from '../../api/types'

// Mock the api client module
vi.mock('../../api/client', () => ({
  apiClient: {
    listWorkflows: vi.fn(),
    listSamplePresets: vi.fn(),
    getComfyUIModels: vi.fn(),
    createSampleJob: vi.fn(),
  },
}))

import { apiClient } from '../../api/client'

const mockListWorkflows = apiClient.listWorkflows as ReturnType<typeof vi.fn>
const mockListSamplePresets = apiClient.listSamplePresets as ReturnType<typeof vi.fn>
const mockGetComfyUIModels = apiClient.getComfyUIModels as ReturnType<typeof vi.fn>
const mockCreateSampleJob = apiClient.createSampleJob as ReturnType<typeof vi.fn>

const sampleTrainingRun: TrainingRun = {
  id: 1,
  name: 'qwen/psai4rt-v0.3.0',
  checkpoint_count: 5,
  has_samples: false,
  checkpoints: [
    { filename: 'checkpoint1.safetensors', step_number: 1000, has_samples: false },
    { filename: 'checkpoint2.safetensors', step_number: 2000, has_samples: false },
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
    samplers: ['euler'],
    schedulers: ['normal'],
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
    samplers: ['euler', 'dpmpp_2m'],
    schedulers: ['normal', 'karras'],
    seeds: [42, 420],
    width: 1024,
    height: 1024,
    images_per_checkpoint: 96,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const vaeModels = ['ae.safetensors', 'vae-ft-mse.safetensors']
const clipModels = ['clip_l.safetensors', 't5xxl_fp16.safetensors']

describe('JobLaunchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListWorkflows.mockResolvedValue(sampleWorkflows)
    mockListSamplePresets.mockResolvedValue(samplePresets)
    mockGetComfyUIModels.mockImplementation((type: string) => {
      if (type === 'vae') return Promise.resolve({ models: vaeModels })
      if (type === 'clip') return Promise.resolve({ models: clipModels })
      return Promise.resolve({ models: [] })
    })
  })

  it('renders a modal with title "Generate Samples"', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('title')).toBe('Generate Samples')
  })

  it('fetches workflows, presets, and ComfyUI models on mount', async () => {
    mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    expect(mockListWorkflows).toHaveBeenCalledTimes(1)
    expect(mockListSamplePresets).toHaveBeenCalledTimes(1)
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('vae')
    expect(mockGetComfyUIModels).toHaveBeenCalledWith('clip')
  })

  it('populates workflow select with valid workflows only', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
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
      props: { show: true, trainingRun: sampleTrainingRun },
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
      props: { show: true, trainingRun: sampleTrainingRun },
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

  it('displays confirmation summary with correct calculations', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select a preset
    const presetSelect = wrapper.find('[data-testid="preset-select"]')
    const select = presetSelect.findComponent(NSelect)
    select.vm.$emit('update:value', 'preset-2')
    await nextTick()

    const summary = wrapper.find('[data-testid="job-summary"]')
    expect(summary.text()).toContain('Training Run: qwen/psai4rt-v0.3.0')
    expect(summary.text()).toContain('Checkpoints: 5')
    expect(summary.text()).toContain('Images per checkpoint: 96')
    expect(summary.text()).toContain('Total images: 480')
  })

  it('disables submit button when required fields are missing', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    expect(submitButton).toBeDefined()
    expect(submitButton!.props('disabled')).toBe(true)
  })

  it('enables submit button when all required fields are filled', async () => {
    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Select all required fields
    const workflowSelect = wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect)
    workflowSelect.vm.$emit('update:value', 'qwen-image.json')
    await nextTick()

    const presetSelect = wrapper.find('[data-testid="preset-select"]').findComponent(NSelect)
    presetSelect.vm.$emit('update:value', 'preset-1')
    await nextTick()

    const vaeSelect = wrapper.find('[data-testid="vae-select"]').findComponent(NSelect)
    vaeSelect.vm.$emit('update:value', 'ae.safetensors')
    await nextTick()

    const clipSelect = wrapper.find('[data-testid="clip-select"]').findComponent(NSelect)
    clipSelect.vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    expect(submitButton!.props('disabled')).toBe(false)
  })

  it('creates sample job with correct payload when submitted', async () => {
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
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreateSampleJob.mockResolvedValue(mockJob)

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Fill form
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    // Submit
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
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreateSampleJob.mockResolvedValue(mockJob)

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Fill form with workflow that has shift role
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'auraflow-image.json')
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const shiftInput = wrapper.find('[data-testid="shift-input"]').findComponent(NInputNumber)
    shiftInput.vm.$emit('update:value', 3.0)
    await nextTick()

    // Submit
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
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    mockCreateSampleJob.mockResolvedValue(mockJob)

    const wrapper = mount(JobLaunchDialog, {
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Fill and submit
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
      props: { show: true, trainingRun: sampleTrainingRun },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // Fill and submit
    wrapper.find('[data-testid="workflow-select"]').findComponent(NSelect).vm.$emit('update:value', 'qwen-image.json')
    wrapper.find('[data-testid="preset-select"]').findComponent(NSelect).vm.$emit('update:value', 'preset-1')
    wrapper.find('[data-testid="vae-select"]').findComponent(NSelect).vm.$emit('update:value', 'ae.safetensors')
    wrapper.find('[data-testid="clip-select"]').findComponent(NSelect).vm.$emit('update:value', 'clip_l.safetensors')
    await nextTick()

    const buttons = wrapper.findAllComponents(NButton)
    const submitButton = buttons.find(b => b.text() === 'Generate Samples')
    await submitButton!.trigger('click')
    await flushPromises()

    // The error message should be visible in the component text
    expect(wrapper.text()).toContain('Failed to create job')
  })
})

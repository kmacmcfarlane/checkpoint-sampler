import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NButton, NTag, NProgress, NEmpty } from 'naive-ui'
import JobProgressPanel from '../JobProgressPanel.vue'
import type { SampleJob } from '../../api/types'

const sampleJobs: SampleJob[] = [
  {
    id: 'job-1',
    training_run_name: 'qwen/psai4rt-v0.3.0',
    sample_preset_id: 'preset-1',
    workflow_name: 'qwen-image.json',
    vae: 'ae.safetensors',
    clip: 'clip_l.safetensors',
    status: 'running',
    total_items: 100,
    completed_items: 40,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'job-2',
    training_run_name: 'sdxl/finetune',
    sample_preset_id: 'preset-2',
    workflow_name: 'sdxl-image.json',
    vae: 'vae.safetensors',
    clip: 'clip.safetensors',
    status: 'paused',
    total_items: 50,
    completed_items: 25,
    created_at: '2025-01-01T01:00:00Z',
    updated_at: '2025-01-01T01:00:00Z',
  },
  {
    id: 'job-3',
    training_run_name: 'flux/test',
    sample_preset_id: 'preset-1',
    workflow_name: 'flux-image.json',
    vae: 'ae.safetensors',
    clip: 't5.safetensors',
    status: 'completed',
    total_items: 200,
    completed_items: 200,
    created_at: '2025-01-01T02:00:00Z',
    updated_at: '2025-01-01T02:00:00Z',
  },
  {
    id: 'job-4',
    training_run_name: 'test/failed',
    sample_preset_id: 'preset-1',
    workflow_name: 'test.json',
    vae: 'ae.safetensors',
    clip: 'clip.safetensors',
    status: 'failed',
    total_items: 10,
    completed_items: 5,
    error_message: 'ComfyUI connection lost',
    created_at: '2025-01-01T03:00:00Z',
    updated_at: '2025-01-01T03:00:00Z',
  },
]

describe('JobProgressPanel', () => {
  it('renders a modal with title "Sample Jobs"', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: [] },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    expect(modal.exists()).toBe(true)
    expect(modal.props('title')).toBe('Sample Jobs')
  })

  it('shows empty state when no jobs are present', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: [] },
      global: { stubs: { Teleport: true } },
    })

    const empty = wrapper.findComponent(NEmpty)
    expect(empty.exists()).toBe(true)
    expect(empty.props('description')).toBe('No sample jobs yet')
  })

  it('displays all jobs in reverse chronological order', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const jobItems = wrapper.findAll('.job-item')
    expect(jobItems).toHaveLength(4)

    // Most recent first (job-4, job-3, job-2, job-1)
    expect(jobItems[0].text()).toContain('test/failed')
    expect(jobItems[1].text()).toContain('flux/test')
    expect(jobItems[2].text()).toContain('sdxl/finetune')
    expect(jobItems[3].text()).toContain('qwen/psai4rt-v0.3.0')
  })

  it('displays job status with correct tag type', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const runningJobTag = wrapper.find('[data-testid="job-job-1-status"]').findComponent(NTag)
    expect(runningJobTag.props('type')).toBe('info')

    const pausedJobTag = wrapper.find('[data-testid="job-job-2-status"]').findComponent(NTag)
    expect(pausedJobTag.props('type')).toBe('warning')

    const completedJobTag = wrapper.find('[data-testid="job-job-3-status"]').findComponent(NTag)
    expect(completedJobTag.props('type')).toBe('success')

    const failedJobTag = wrapper.find('[data-testid="job-job-4-status"]').findComponent(NTag)
    expect(failedJobTag.props('type')).toBe('error')
  })

  it('displays progress percentage correctly', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const runningJob = wrapper.find('[data-testid="job-job-1"]')
    expect(runningJob.text()).toContain('40 / 100 items')
    expect(runningJob.text()).toContain('40%')

    const completedJob = wrapper.find('[data-testid="job-job-3"]')
    expect(completedJob.text()).toContain('200 / 200 items')
    expect(completedJob.text()).toContain('100%')
  })

  it('shows stop button only for running jobs', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const runningJobStopButton = wrapper.find('[data-testid="job-job-1-stop"]')
    expect(runningJobStopButton.exists()).toBe(true)

    const pausedJobStopButton = wrapper.find('[data-testid="job-job-2-stop"]')
    expect(pausedJobStopButton.exists()).toBe(false)

    const completedJobStopButton = wrapper.find('[data-testid="job-job-3-stop"]')
    expect(completedJobStopButton.exists()).toBe(false)
  })

  it('shows resume button only for paused jobs', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const pausedJobResumeButton = wrapper.find('[data-testid="job-job-2-resume"]')
    expect(pausedJobResumeButton.exists()).toBe(true)

    const runningJobResumeButton = wrapper.find('[data-testid="job-job-1-resume"]')
    expect(runningJobResumeButton.exists()).toBe(false)

    const completedJobResumeButton = wrapper.find('[data-testid="job-job-3-resume"]')
    expect(completedJobResumeButton.exists()).toBe(false)
  })

  it('emits stop event when stop button is clicked', async () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const stopButton = wrapper.find('[data-testid="job-job-1-stop"]').findComponent(NButton)
    await stopButton.trigger('click')

    const emitted = wrapper.emitted('stop')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['job-1'])
  })

  it('emits resume event when resume button is clicked', async () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const resumeButton = wrapper.find('[data-testid="job-job-2-resume"]').findComponent(NButton)
    await resumeButton.trigger('click')

    const emitted = wrapper.emitted('resume')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    expect(emitted![0]).toEqual(['job-2'])
  })

  it('emits refresh event when refresh button is clicked', async () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const buttons = wrapper.findAllComponents(NButton)
    const refreshButton = buttons.find(b => b.text() === 'Refresh')
    await refreshButton!.trigger('click')

    const emitted = wrapper.emitted('refresh')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
  })

  it('displays error message for failed jobs', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const failedJob = wrapper.find('[data-testid="job-job-4"]')
    const errorMessage = failedJob.find('.error-message')
    expect(errorMessage.exists()).toBe(true)
    expect(errorMessage.text()).toBe('ComfyUI connection lost')
  })

  it('shows loading spinner when loading prop is true', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs, loading: true },
      global: { stubs: { Teleport: true } },
    })

    const buttons = wrapper.findAllComponents(NButton)
    const refreshButton = buttons.find(b => b.text() === 'Refresh')
    expect(refreshButton!.props('loading')).toBe(true)
  })

  it('emits close event when modal is closed', async () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const modal = wrapper.findComponent(NModal)
    modal.vm.$emit('update:show', false)
    await nextTick()

    const emitted = wrapper.emitted('close')
    expect(emitted).toBeDefined()
  })

  it('displays workflow name and creation timestamp', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const job = wrapper.find('[data-testid="job-job-1"]')
    expect(job.text()).toContain('qwen-image.json')
    expect(job.text()).toContain('Created:')
  })
})

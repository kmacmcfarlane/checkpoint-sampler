import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NButton, NTag, NProgress, NEmpty } from 'naive-ui'
import JobProgressPanel from '../JobProgressPanel.vue'
import type { SampleJob } from '../../api/types'

// enableAutoUnmount is configured globally in vitest.setup.ts

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
    failed_items: 0,
    pending_items: 60,
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
    status: 'stopped',
    total_items: 50,
    completed_items: 25,
    failed_items: 0,
    pending_items: 25,
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
    failed_items: 0,
    pending_items: 0,
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
    failed_items: 3,
    pending_items: 2,
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

    const stoppedJobTag = wrapper.find('[data-testid="job-job-2-status"]').findComponent(NTag)
    expect(stoppedJobTag.props('type')).toBe('error')

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

    const stoppedJobStopButton = wrapper.find('[data-testid="job-job-2-stop"]')
    expect(stoppedJobStopButton.exists()).toBe(false)

    const completedJobStopButton = wrapper.find('[data-testid="job-job-3-stop"]')
    expect(completedJobStopButton.exists()).toBe(false)
  })

  it('shows resume button only for stopped jobs', () => {
    const wrapper = mount(JobProgressPanel, {
      props: { show: true, jobs: sampleJobs },
      global: { stubs: { Teleport: true } },
    })

    const stoppedJobResumeButton = wrapper.find('[data-testid="job-job-2-resume"]')
    expect(stoppedJobResumeButton.exists()).toBe(true)

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

  describe('item counts display', () => {
    it('displays item counts section for each job', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const counts = wrapper.find('[data-testid="job-job-1-counts"]')
      expect(counts.exists()).toBe(true)
      expect(counts.text()).toContain('40 completed')
      expect(counts.text()).toContain('60 pending')
    })

    it('shows failed count in red for jobs with failures', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const failedCount = wrapper.find('[data-testid="job-job-4-failed-count"]')
      expect(failedCount.exists()).toBe(true)
      expect(failedCount.text()).toBe('3 failed')
    })

    it('does not show failed count for jobs without failures', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const failedCount = wrapper.find('[data-testid="job-job-1-failed-count"]')
      expect(failedCount.exists()).toBe(false)
    })
  })

  describe('theme-aware styling', () => {
    it('job-item uses theme-aware CSS class without hardcoded inline colors', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const jobItem = wrapper.find('.job-item')
      expect(jobItem.exists()).toBe(true)
      // No inline style overrides with hardcoded colors
      expect(jobItem.attributes('style')).toBeUndefined()
    })

    it('job-meta element has the correct CSS class for theme-aware text color', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const jobMeta = wrapper.find('[data-testid="job-job-1"] .job-meta')
      expect(jobMeta.exists()).toBe(true)
      expect(jobMeta.classes()).toContain('job-meta')
      // Verify no hardcoded color inline style
      expect(jobMeta.attributes('style')).toBeUndefined()
    })

    it('progress-text element has the correct CSS class for theme-aware text color', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const progressText = wrapper.find('[data-testid="job-job-1"] .progress-text')
      expect(progressText.exists()).toBe(true)
      expect(progressText.classes()).toContain('progress-text')
      expect(progressText.attributes('style')).toBeUndefined()
    })

    it('progress-line elements have the correct CSS class for theme-aware text color', () => {
      const jobWithProgress: SampleJob = {
        id: 'job-progress',
        training_run_name: 'test/run',
        sample_preset_id: 'preset-1',
        workflow_name: 'test.json',
        vae: 'ae.safetensors',
        clip: 'clip.safetensors',
        status: 'running',
        total_items: 10,
        completed_items: 3,
        failed_items: 0,
        pending_items: 7,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithProgress],
          jobProgress: {
            'job-progress': {
              checkpoints_completed: 2,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-002.safetensors',
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const progressLines = wrapper.findAll('.progress-line')
      expect(progressLines.length).toBeGreaterThan(0)
      for (const line of progressLines) {
        expect(line.classes()).toContain('progress-line')
        expect(line.attributes('style')).toBeUndefined()
      }
    })

    it('item-counts element has the correct CSS class for theme-aware text color', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      const itemCounts = wrapper.find('[data-testid="job-job-1-counts"]')
      expect(itemCounts.exists()).toBe(true)
      expect(itemCounts.classes()).toContain('item-counts')
      expect(itemCounts.attributes('style')).toBeUndefined()
    })

    it('progress-details container has the correct CSS class for theme-aware background', () => {
      const jobWithProgress: SampleJob = {
        id: 'job-prog2',
        training_run_name: 'test/run2',
        sample_preset_id: 'preset-1',
        workflow_name: 'test.json',
        vae: 'ae.safetensors',
        clip: 'clip.safetensors',
        status: 'running',
        total_items: 10,
        completed_items: 3,
        failed_items: 0,
        pending_items: 7,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithProgress],
          jobProgress: {
            'job-prog2': {
              checkpoints_completed: 1,
              total_checkpoints: 4,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const progressDetails = wrapper.find('.progress-details')
      expect(progressDetails.exists()).toBe(true)
      expect(progressDetails.classes()).toContain('progress-details')
      expect(progressDetails.attributes('style')).toBeUndefined()
    })
  })

  describe('completed_with_errors status', () => {
    const jobWithErrors: SampleJob = {
      id: 'job-errors',
      training_run_name: 'test/partial',
      sample_preset_id: 'preset-1',
      workflow_name: 'test.json',
      vae: 'ae.safetensors',
      clip: 'clip.safetensors',
      status: 'completed_with_errors',
      total_items: 10,
      completed_items: 7,
      failed_items: 3,
      pending_items: 0,
      failed_item_details: [
        { checkpoint_filename: 'chk-a.safetensors', error_message: 'VRAM overflow' },
        { checkpoint_filename: 'chk-b.safetensors', error_message: 'VRAM overflow' },
        { checkpoint_filename: 'chk-c.safetensors', error_message: 'timeout expired' },
      ],
      created_at: '2025-01-01T04:00:00Z',
      updated_at: '2025-01-01T04:00:00Z',
    }

    it('displays completed_with_errors status as warning tag', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithErrors] },
        global: { stubs: { Teleport: true } },
      })

      const tag = wrapper.find('[data-testid="job-job-errors-status"]').findComponent(NTag)
      expect(tag.props('type')).toBe('warning')
      expect(tag.text()).toBe('completed with errors')
    })

    it('shows warning progress bar for completed_with_errors jobs', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithErrors] },
        global: { stubs: { Teleport: true } },
      })

      const progress = wrapper.find('[data-testid="job-job-errors"]').findComponent(NProgress)
      expect(progress.props('status')).toBe('warning')
    })

    it('shows expandable error section for jobs with failed items', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithErrors] },
        global: { stubs: { Teleport: true } },
      })

      const errorSection = wrapper.find('[data-testid="job-job-errors-error-section"]')
      expect(errorSection.exists()).toBe(true)
    })

    it('expands error details when toggle is clicked', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithErrors] },
        global: { stubs: { Teleport: true } },
      })

      // Initially collapsed
      expect(wrapper.find('[data-testid="job-job-errors-error-details"]').exists()).toBe(false)

      // Click toggle
      await wrapper.find('[data-testid="job-job-errors-error-toggle"]').trigger('click')
      await nextTick()

      // Now expanded
      const details = wrapper.find('[data-testid="job-job-errors-error-details"]')
      expect(details.exists()).toBe(true)
    })

    it('groups errors by error message in expanded details', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithErrors] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-errors-error-toggle"]').trigger('click')
      await nextTick()

      const details = wrapper.find('[data-testid="job-job-errors-error-details"]')
      const groups = details.findAll('.error-group')

      // Two error groups: 'VRAM overflow' (2 checkpoints) and 'timeout expired' (1 checkpoint)
      expect(groups).toHaveLength(2)

      const groupTexts = groups.map(g => g.text())
      const vramGroup = groupTexts.find(t => t.includes('VRAM overflow'))
      expect(vramGroup).toBeDefined()
      expect(vramGroup).toContain('2 checkpoints')

      const timeoutGroup = groupTexts.find(t => t.includes('timeout expired'))
      expect(timeoutGroup).toBeDefined()
      expect(timeoutGroup).toContain('1 checkpoint')
    })

    it('does not show error section for jobs without failures', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      // job-1 has no failures
      const errorSection = wrapper.find('[data-testid="job-job-1-error-section"]')
      expect(errorSection.exists()).toBe(false)
    })
  })
})

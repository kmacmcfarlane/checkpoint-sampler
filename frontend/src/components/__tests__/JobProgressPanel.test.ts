import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NModal, NButton, NTag, NProgress, NEmpty } from 'naive-ui'
import JobProgressPanel from '../JobProgressPanel.vue'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog.vue'
import type { SampleJob } from '../../api/types'

// enableAutoUnmount is configured globally in vitest.setup.ts

const sampleJobs: SampleJob[] = [
  {
    id: 'job-1',
    training_run_name: 'qwen/psai4rt-v0.3.0',
    study_id: 'preset-1', study_name: 'Quick Test',
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
    study_id: 'preset-2', study_name: 'Full Test',
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
    study_id: 'preset-1', study_name: 'Quick Test',
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
    study_id: 'preset-1', study_name: 'Quick Test',
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
        study_id: 'preset-1', study_name: 'Quick Test',
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
        study_id: 'preset-1', study_name: 'Quick Test',
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
      study_id: 'preset-1', study_name: 'Quick Test',
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

  // AC: FE: JobProgressPanel shows completeness status per checkpoint
  describe('completeness status display', () => {
    const jobWithCompleteness: SampleJob = {
      id: 'job-complete',
      training_run_name: 'test/completeness',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'test.json',
      vae: 'ae.safetensors',
      clip: 'clip.safetensors',
      status: 'running',
      total_items: 6,
      completed_items: 4,
      failed_items: 0,
      pending_items: 2,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    // AC: FE: Shows '24/24 verified' for fully verified checkpoints
    it('displays completeness status when all images are verified', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithCompleteness],
          jobProgress: {
            'job-complete': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'ckpt1.safetensors', expected: 4, verified: 4, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const completeness = wrapper.find('[data-testid="job-job-complete-completeness"]')
      expect(completeness.exists()).toBe(true)
      expect(completeness.text()).toContain('4/4 verified')
      expect(completeness.text()).toContain('ckpt1.safetensors')
    })

    // AC: FE: Shows '23/24 -- 1 missing' for checkpoints with missing files
    it('displays missing count when some images are missing', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithCompleteness],
          jobProgress: {
            'job-complete': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'ckpt1.safetensors', expected: 24, verified: 23, missing: 1 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const completeness = wrapper.find('[data-testid="job-job-complete-completeness"]')
      expect(completeness.exists()).toBe(true)
      expect(completeness.text()).toContain('23/24 -- 1 missing')
    })

    it('does not show completeness section when no completeness data is available', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithCompleteness],
          jobProgress: {
            'job-complete': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const completeness = wrapper.find('[data-testid="job-job-complete-completeness"]')
      expect(completeness.exists()).toBe(false)
    })

    it('sorts completeness entries by checkpoint name', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithCompleteness],
          jobProgress: {
            'job-complete': {
              checkpoints_completed: 2,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'ckpt-b.safetensors', expected: 2, verified: 2, missing: 0 },
                { checkpoint: 'ckpt-a.safetensors', expected: 2, verified: 2, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const lines = wrapper.findAll('.completeness-line')
      expect(lines).toHaveLength(2)
      // First entry should be ckpt-a (alphabetically first)
      expect(lines[0].text()).toContain('ckpt-a.safetensors')
      expect(lines[1].text()).toContain('ckpt-b.safetensors')
    })

    it('applies missing CSS class to entries with missing files', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithCompleteness],
          jobProgress: {
            'job-complete': {
              checkpoints_completed: 2,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'ckpt-ok.safetensors', expected: 4, verified: 4, missing: 0 },
                { checkpoint: 'ckpt-missing.safetensors', expected: 4, verified: 3, missing: 1 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const lines = wrapper.findAll('.completeness-line')
      // ckpt-missing should have the --missing class (sorted first: ckpt-missing, then ckpt-ok)
      const missingLine = lines.find(l => l.text().includes('ckpt-missing.safetensors'))
      expect(missingLine).toBeDefined()
      expect(missingLine!.classes()).toContain('completeness-line--missing')

      const okLine = lines.find(l => l.text().includes('ckpt-ok.safetensors'))
      expect(okLine).toBeDefined()
      expect(okLine!.classes()).not.toContain('completeness-line--missing')
    })
  })

  // AC2 (B-052): 'verified' label fits container without wrapping
  // AC3 (B-052): Truncated checkpoint names show tooltip with full name on hover
  describe('completeness label and tooltip cosmetics (B-052)', () => {
    const jobWithLongCheckpoint: SampleJob = {
      id: 'job-long-ckpt',
      training_run_name: 'test/long-names',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'test.json',
      vae: 'ae.safetensors',
      clip: 'clip.safetensors',
      status: 'running',
      total_items: 4,
      completed_items: 2,
      failed_items: 0,
      pending_items: 2,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    // AC2: 'verified' status label has .completeness-status class (CSS prevents wrapping)
    it('completeness status span has completeness-status class to prevent label wrapping', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithLongCheckpoint],
          jobProgress: {
            'job-long-ckpt': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'short.safetensors', expected: 4, verified: 4, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      // The second span (status text) must have the completeness-status class
      const completenessLine = wrapper.find('.completeness-line')
      const spans = completenessLine.findAll('span')
      const statusSpan = spans.find(s => s.classes().includes('completeness-status'))
      expect(statusSpan).toBeDefined()
      // The text should contain the formatted completeness string
      expect(statusSpan!.text()).toContain('4/4 verified')
    })

    // AC2: completeness-checkpoint span has min-width: 0 allowing ellipsis truncation in flex
    it('completeness-checkpoint span has the completeness-checkpoint class', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithLongCheckpoint],
          jobProgress: {
            'job-long-ckpt': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'a-very-long-checkpoint-filename-that-would-truncate.safetensors', expected: 24, verified: 24, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const checkpointSpan = wrapper.find('.completeness-checkpoint')
      expect(checkpointSpan.exists()).toBe(true)
      // The checkpoint span should NOT have inline styles overriding CSS
      expect(checkpointSpan.attributes('style')).toBeUndefined()
    })

    // AC3: Truncated checkpoint names show a tooltip with the full name on hover
    it('completeness-checkpoint span has a title attribute with the full checkpoint name', () => {
      const fullName = 'a-very-long-checkpoint-filename-that-would-be-truncated-by-ellipsis.safetensors'
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithLongCheckpoint],
          jobProgress: {
            'job-long-ckpt': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: fullName, expected: 24, verified: 24, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      // AC3: title attribute must match the full checkpoint name
      const checkpointSpan = wrapper.find('.completeness-checkpoint')
      expect(checkpointSpan.exists()).toBe(true)
      expect(checkpointSpan.attributes('title')).toBe(fullName)
    })

    // AC3: Short checkpoint names also have the title attribute (tooltip for all entries)
    it('completeness-checkpoint span has title attribute even for short names', () => {
      const shortName = 'short.safetensors'
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithLongCheckpoint],
          jobProgress: {
            'job-long-ckpt': {
              checkpoints_completed: 1,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: shortName, expected: 4, verified: 4, missing: 0 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const checkpointSpan = wrapper.find('.completeness-checkpoint')
      expect(checkpointSpan.attributes('title')).toBe(shortName)
    })

    // AC3: Each entry in a multi-entry completeness list has the correct title
    it('each completeness-checkpoint span carries the title of its own entry', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [jobWithLongCheckpoint],
          jobProgress: {
            'job-long-ckpt': {
              checkpoints_completed: 2,
              total_checkpoints: 2,
              checkpoint_completeness: [
                { checkpoint: 'alpha-very-long.safetensors', expected: 4, verified: 4, missing: 0 },
                { checkpoint: 'beta-very-long.safetensors', expected: 4, verified: 3, missing: 1 },
              ],
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const checkpointSpans = wrapper.findAll('.completeness-checkpoint')
      expect(checkpointSpans).toHaveLength(2)
      // Sorted alphabetically: alpha first, beta second
      expect(checkpointSpans[0].attributes('title')).toBe('alpha-very-long.safetensors')
      expect(checkpointSpans[1].attributes('title')).toBe('beta-very-long.safetensors')
    })
  })

  // AC: FE: JobProgressPanel shows a secondary progress bar for the currently-generating sample
  describe('inference progress bar', () => {
    const runningJob: SampleJob = {
      id: 'job-running',
      training_run_name: 'test/inference',
      study_id: 'preset-1', study_name: 'Quick Test',
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

    // AC: FE: Progress bar updates in real-time as ComfyUI processes nodes
    it('shows inference progress bar when inference progress data is present', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJob],
          jobProgress: {
            'job-running': {
              checkpoints_completed: 1,
              total_checkpoints: 3,
              current_checkpoint: 'ckpt.safetensors',
              current_checkpoint_progress: 1,
              current_checkpoint_total: 5,
            },
          },
          inferenceProgress: {
            'job-running': { current_value: 5, max_value: 20 },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const inferenceSection = wrapper.find('[data-testid="job-job-running-inference-progress"]')
      expect(inferenceSection.exists()).toBe(true)
      expect(inferenceSection.text()).toContain('5 / 20 steps')
    })

    it('shows correct percentage on inference progress bar', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJob],
          jobProgress: {
            'job-running': {
              checkpoints_completed: 0,
              total_checkpoints: 3,
            },
          },
          inferenceProgress: {
            'job-running': { current_value: 10, max_value: 20 },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const inferenceSection = wrapper.find('[data-testid="job-job-running-inference-progress"]')
      expect(inferenceSection.exists()).toBe(true)
      const progress = inferenceSection.findComponent(NProgress)
      expect(progress.exists()).toBe(true)
      expect(progress.props('percentage')).toBe(50)
    })

    // AC: FE: Progress bar does not show when no inference progress data is present
    it('does not show inference progress bar when no inference progress data is present', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJob],
          jobProgress: {
            'job-running': {
              checkpoints_completed: 0,
              total_checkpoints: 3,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const inferenceSection = wrapper.find('[data-testid="job-job-running-inference-progress"]')
      expect(inferenceSection.exists()).toBe(false)
    })

    // AC: FE: Progress bar resets between samples (not shown when max_value is 0)
    it('does not show inference progress bar when max_value is zero', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJob],
          jobProgress: {
            'job-running': {
              checkpoints_completed: 0,
              total_checkpoints: 3,
            },
          },
          inferenceProgress: {
            'job-running': { current_value: 0, max_value: 0 },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const inferenceSection = wrapper.find('[data-testid="job-job-running-inference-progress"]')
      expect(inferenceSection.exists()).toBe(false)
    })

    it('does not show inference progress bar for completed jobs', () => {
      const completedJob: SampleJob = {
        ...runningJob,
        id: 'job-done',
        status: 'completed',
        completed_items: 10,
        pending_items: 0,
      }
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [completedJob],
          inferenceProgress: {
            'job-done': { current_value: 5, max_value: 20 },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      // Even if inferenceProgress data exists, the progress-details section won't show
      // since there's no checkpoint progress, so the inference progress bar won't appear.
      const inferenceSection = wrapper.find('[data-testid="job-job-done-inference-progress"]')
      expect(inferenceSection.exists()).toBe(false)
    })

    it('shows inference progress at 100% when current equals max', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJob],
          jobProgress: {
            'job-running': {
              checkpoints_completed: 0,
              total_checkpoints: 3,
            },
          },
          inferenceProgress: {
            'job-running': { current_value: 20, max_value: 20 },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const inferenceSection = wrapper.find('[data-testid="job-job-running-inference-progress"]')
      expect(inferenceSection.exists()).toBe(true)
      const progress = inferenceSection.findComponent(NProgress)
      expect(progress.props('percentage')).toBe(100)
    })
  })

  // AC: FE: Show error summary (exception_type + node_type + exception_message) for failed checkpoints
  // AC: FE: 'Show full traceback' toggle reveals the complete Python stack trace
  describe('structured error display and traceback toggle', () => {
    const jobWithStructuredErrors: SampleJob = {
      id: 'job-structured',
      training_run_name: 'test/vae-mismatch',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'flux.json',
      vae: 'ae.safetensors',
      clip: 'clip.safetensors',
      status: 'completed_with_errors',
      total_items: 10,
      completed_items: 7,
      failed_items: 3,
      pending_items: 0,
      failed_item_details: [
        {
          checkpoint_filename: 'chk-a.safetensors',
          error_message: '[RuntimeError] VAEDecode: channels mismatch',
          exception_type: 'RuntimeError',
          node_type: 'VAEDecode',
          traceback: 'Traceback (most recent call last):\n  File "/comfyui/execution.py", line 123\nRuntimeError: channels mismatch\n',
        },
        {
          checkpoint_filename: 'chk-b.safetensors',
          error_message: '[RuntimeError] VAEDecode: channels mismatch',
          exception_type: 'RuntimeError',
          node_type: 'VAEDecode',
          traceback: 'Traceback (most recent call last):\n  File "/comfyui/execution.py", line 123\nRuntimeError: channels mismatch\n',
        },
        {
          checkpoint_filename: 'chk-c.safetensors',
          error_message: 'generic error without traceback',
        },
      ],
      created_at: '2025-01-01T04:00:00Z',
      updated_at: '2025-01-01T04:00:00Z',
    }

    // AC: FE: Error display is per-checkpoint, shown inline in the job progress card
    it('shows structured error summary with exception_type and node_type in error groups', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      // Expand the error section
      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()

      const details = wrapper.find('[data-testid="job-job-structured-error-details"]')
      expect(details.exists()).toBe(true)

      const groups = details.findAll('.error-group')
      // Two groups: one for [RuntimeError] VAEDecode (2 checkpoints), one for generic error (1 checkpoint)
      expect(groups).toHaveLength(2)

      const groupTexts = groups.map(g => g.text())
      const vaeGroup = groupTexts.find(t => t.includes('[RuntimeError] VAEDecode'))
      expect(vaeGroup).toBeDefined()
      expect(vaeGroup).toContain('2 checkpoints')
    })

    // AC: FE: 'Show full traceback' toggle appears for errors with traceback
    it('shows traceback toggle button for errors with traceback data', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      // Expand the error section
      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()

      // The first error group (VAEDecode) has a traceback -> toggle should be visible
      const tracebackToggle = wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]')
      expect(tracebackToggle.exists()).toBe(true)
      expect(tracebackToggle.text()).toBe('Show full traceback')
    })

    it('does not show traceback toggle for errors without traceback', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()

      // The second error group (generic error) has no traceback -> no toggle
      const tracebackToggle = wrapper.find('[data-testid="job-job-structured-traceback-toggle-1"]')
      expect(tracebackToggle.exists()).toBe(false)
    })

    // AC: FE: Clicking the toggle reveals the complete Python stack trace
    it('reveals traceback content when toggle is clicked', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      // Expand the error section
      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()

      // Initially traceback content is hidden
      expect(wrapper.find('[data-testid="job-job-structured-traceback-content-0"]').exists()).toBe(false)

      // Click the traceback toggle
      await wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]').trigger('click')
      await nextTick()

      // Traceback content should now be visible
      const tracebackContent = wrapper.find('[data-testid="job-job-structured-traceback-content-0"]')
      expect(tracebackContent.exists()).toBe(true)
      expect(tracebackContent.text()).toContain('Traceback (most recent call last)')
      expect(tracebackContent.text()).toContain('RuntimeError: channels mismatch')
    })

    it('hides traceback content when toggle is clicked again', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      // Expand the error section and the traceback
      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]').trigger('click')
      await nextTick()

      // Toggle button should now say 'Hide full traceback'
      const toggle = wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]')
      expect(toggle.text()).toBe('Hide full traceback')

      // Click again to hide
      await toggle.trigger('click')
      await nextTick()

      expect(wrapper.find('[data-testid="job-job-structured-traceback-content-0"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]').text()).toBe('Show full traceback')
    })

    it('renders traceback in a pre element for proper formatting', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithStructuredErrors] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-structured-error-toggle"]').trigger('click')
      await nextTick()
      await wrapper.find('[data-testid="job-job-structured-traceback-toggle-0"]').trigger('click')
      await nextTick()

      const tracebackContent = wrapper.find('[data-testid="job-job-structured-traceback-content-0"]')
      expect(tracebackContent.element.tagName).toBe('PRE')
    })
  })

  // AC: FE: Completed and completed-with-errors job cards show a 'Regenerate' button
  describe('regenerate button', () => {
    const completedJob: SampleJob = {
      id: 'job-completed',
      training_run_name: 'flux/test',
      study_id: 'preset-1', study_name: 'Quick Test',
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
    }

    const completedWithErrorsJob: SampleJob = {
      id: 'job-with-errors',
      training_run_name: 'test/partial',
      study_id: 'preset-1', study_name: 'Quick Test',
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
      ],
      created_at: '2025-01-01T04:00:00Z',
      updated_at: '2025-01-01T04:00:00Z',
    }

    // AC: Regenerate button is visible on completed jobs
    it('shows regenerate button for completed jobs', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [completedJob] },
        global: { stubs: { Teleport: true } },
      })

      const regenerateButton = wrapper.find('[data-testid="job-job-completed-regenerate"]')
      expect(regenerateButton.exists()).toBe(true)
      expect(regenerateButton.text()).toBe('Regenerate')
    })

    // AC: Regenerate button is visible on completed_with_errors jobs
    it('shows regenerate button for completed_with_errors jobs', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [completedWithErrorsJob] },
        global: { stubs: { Teleport: true } },
      })

      const regenerateButton = wrapper.find('[data-testid="job-job-with-errors-regenerate"]')
      expect(regenerateButton.exists()).toBe(true)
    })

    // AC: Regenerate button is NOT shown on running, stopped, pending, or failed jobs
    it('does not show regenerate button for running jobs', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      // job-1 is running
      expect(wrapper.find('[data-testid="job-job-1-regenerate"]').exists()).toBe(false)
      // job-2 is stopped
      expect(wrapper.find('[data-testid="job-job-2-regenerate"]').exists()).toBe(false)
      // job-4 is failed
      expect(wrapper.find('[data-testid="job-job-4-regenerate"]').exists()).toBe(false)
    })

    // AC: Clicking Regenerate emits regenerate event with the full job object
    it('emits regenerate event with the job when clicked', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [completedJob] },
        global: { stubs: { Teleport: true } },
      })

      const regenerateButton = wrapper.find('[data-testid="job-job-completed-regenerate"]').findComponent(NButton)
      await regenerateButton.trigger('click')

      const emitted = wrapper.emitted('regenerate')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual([completedJob])
    })
  })

  // AC1: Delete button on each job card opens the standard confirmation dialog
  // AC2: Confirmation dialog includes 'Also delete sample data' checkbox
  describe('delete button and confirmation dialog', () => {
    const jobToDelete: SampleJob = {
      id: 'job-pending',
      training_run_name: 'flux/delete-test',
      study_id: 'study-1',
      study_name: 'Delete Test',
      workflow_name: 'flux.json',
      vae: 'ae.safetensors',
      clip: 't5.safetensors',
      status: 'pending',
      total_items: 50,
      completed_items: 0,
      failed_items: 0,
      pending_items: 50,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    // AC1: Delete button is shown on every job card regardless of status
    it('shows a Delete button on every job card', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: sampleJobs },
        global: { stubs: { Teleport: true } },
      })

      // All 4 sample jobs should have a delete button
      expect(wrapper.find('[data-testid="job-job-1-delete"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="job-job-2-delete"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="job-job-3-delete"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="job-job-4-delete"]').exists()).toBe(true)
    })

    // AC1: Clicking Delete opens the ConfirmDeleteDialog
    it('clicking Delete button shows the ConfirmDeleteDialog', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      // Dialog should not be visible initially
      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      expect(dialog.exists()).toBe(true)
      expect(dialog.props('show')).toBe(false)

      // Click the delete button
      const deleteButton = wrapper.find('[data-testid="job-job-pending-delete"]').findComponent(NButton)
      await deleteButton.trigger('click')
      await nextTick()

      // Dialog should now be shown
      expect(dialog.props('show')).toBe(true)
    })

    // AC2: Confirmation dialog includes 'Also delete sample data' checkbox
    it('ConfirmDeleteDialog has a checkboxLabel for "Also delete sample data"', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      expect(dialog.props('checkboxLabel')).toBe('Also delete sample data')
    })

    // AC2: The checkbox defaults to unchecked
    it('ConfirmDeleteDialog checkbox defaults to unchecked (false)', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      expect(dialog.props('checkboxChecked')).toBe(false)
    })

    // AC3: Confirming deletion without checking the checkbox emits delete(id, false)
    it('confirming with deleteData=false emits delete event with id and false', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      // Open the dialog
      const deleteButton = wrapper.find('[data-testid="job-job-pending-delete"]').findComponent(NButton)
      await deleteButton.trigger('click')
      await nextTick()

      // Confirm with deleteData=false (checkbox not checked)
      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      await dialog.vm.$emit('confirm', false)
      await nextTick()

      const emitted = wrapper.emitted('delete')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['job-pending', false])

      // Dialog should be closed after confirm
      expect(dialog.props('show')).toBe(false)
    })

    // AC4: Confirming deletion with checkbox checked emits delete(id, true)
    it('confirming with deleteData=true emits delete event with id and true', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      // Open the dialog
      const deleteButton = wrapper.find('[data-testid="job-job-pending-delete"]').findComponent(NButton)
      await deleteButton.trigger('click')
      await nextTick()

      // Confirm with deleteData=true (checkbox checked)
      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      await dialog.vm.$emit('confirm', true)
      await nextTick()

      const emitted = wrapper.emitted('delete')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual(['job-pending', true])
    })

    // Cancelling the dialog closes it without emitting delete
    it('cancelling the dialog closes it without emitting delete', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobToDelete] },
        global: { stubs: { Teleport: true } },
      })

      // Open the dialog
      const deleteButton = wrapper.find('[data-testid="job-job-pending-delete"]').findComponent(NButton)
      await deleteButton.trigger('click')
      await nextTick()

      const dialog = wrapper.findComponent(ConfirmDeleteDialog)
      expect(dialog.props('show')).toBe(true)

      // Cancel the dialog
      await dialog.vm.$emit('cancel')
      await nextTick()

      // Dialog should be closed and no delete event emitted
      expect(dialog.props('show')).toBe(false)
      expect(wrapper.emitted('delete')).toBeUndefined()
    })
  })

  // AC: FE: Unit tests for ETA display
  describe('ETA display', () => {
    it('displays sample ETA when sample_eta_seconds is provided', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]], // running job
          jobProgress: {
            'job-1': {
              checkpoints_completed: 2,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-3.safetensors',
              current_checkpoint_progress: 3,
              current_checkpoint_total: 10,
              sample_eta_seconds: 45,
              job_eta_seconds: 600,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const sampleEta = wrapper.find('[data-testid="job-job-1-sample-eta"]')
      expect(sampleEta.exists()).toBe(true)
      expect(sampleEta.text()).toContain('Sample ETA:')
      expect(sampleEta.text()).toContain('45s')
    })

    it('displays job ETA when job_eta_seconds is provided', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]], // running job
          jobProgress: {
            'job-1': {
              checkpoints_completed: 2,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-3.safetensors',
              current_checkpoint_progress: 3,
              current_checkpoint_total: 10,
              sample_eta_seconds: 30,
              job_eta_seconds: 600,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(jobEta.exists()).toBe(true)
      expect(jobEta.text()).toContain('Job ETA:')
      expect(jobEta.text()).toContain('10m')
    })

    it('does not display sample ETA when sample_eta_seconds is 0', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]],
          jobProgress: {
            'job-1': {
              checkpoints_completed: 0,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-1.safetensors',
              current_checkpoint_progress: 0,
              current_checkpoint_total: 10,
              sample_eta_seconds: 0,
              job_eta_seconds: 0,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const sampleEta = wrapper.find('[data-testid="job-job-1-sample-eta"]')
      expect(sampleEta.exists()).toBe(false)
    })

    it('does not display job ETA when job_eta_seconds is 0', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]],
          jobProgress: {
            'job-1': {
              checkpoints_completed: 0,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-1.safetensors',
              current_checkpoint_progress: 0,
              current_checkpoint_total: 10,
              sample_eta_seconds: 0,
              job_eta_seconds: 0,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(jobEta.exists()).toBe(false)
    })

    it('does not display ETA when no jobProgress is provided', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]],
        },
        global: { stubs: { Teleport: true } },
      })

      const sampleEta = wrapper.find('[data-testid="job-job-1-sample-eta"]')
      const jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(sampleEta.exists()).toBe(false)
      expect(jobEta.exists()).toBe(false)
    })

    // AC: FE: ETA updates as each sample completes and the average adjusts
    it('updates ETA display when props change', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]],
          jobProgress: {
            'job-1': {
              checkpoints_completed: 1,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-2.safetensors',
              current_checkpoint_progress: 5,
              current_checkpoint_total: 10,
              sample_eta_seconds: 30,
              job_eta_seconds: 1800,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      // Initial: 30m job ETA
      let jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(jobEta.text()).toContain('30m')

      // Update to a lower ETA (simulating samples completing)
      await wrapper.setProps({
        jobProgress: {
          'job-1': {
            checkpoints_completed: 2,
            total_checkpoints: 5,
            current_checkpoint: 'ckpt-3.safetensors',
            current_checkpoint_progress: 2,
            current_checkpoint_total: 10,
            sample_eta_seconds: 20,
            job_eta_seconds: 900,
          },
        },
      })
      await nextTick()

      jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(jobEta.text()).toContain('15m')
    })

    // AC: Test ETA display with varying formats (seconds, minutes, hours)
    it.each([
      { seconds: 5, expected: '5s' },
      { seconds: 45, expected: '45s' },
      { seconds: 60, expected: '1m' },
      { seconds: 90, expected: '1m 30s' },
      { seconds: 150, expected: '2m 30s' },
      { seconds: 3600, expected: '1h 0m' },
      { seconds: 3660, expected: '1h 1m' },
      { seconds: 5400, expected: '1h 30m' },
    ])('formats job ETA of $seconds seconds as "$expected"', ({ seconds, expected }) => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [sampleJobs[0]],
          jobProgress: {
            'job-1': {
              checkpoints_completed: 1,
              total_checkpoints: 5,
              current_checkpoint: 'ckpt-2.safetensors',
              current_checkpoint_progress: 1,
              current_checkpoint_total: 10,
              sample_eta_seconds: 10,
              job_eta_seconds: seconds,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const jobEta = wrapper.find('[data-testid="job-job-1-job-eta"]')
      expect(jobEta.exists()).toBe(true)
      expect(jobEta.text()).toContain(expected)
    })
  })

  // AC1: FE: Clicking a job card title opens a detail view showing all job parameters
  // AC2: FE: Parameters include: training run, workflow, preset name, VAE, CLIP, shift, and checkpoint list
  // AC3: FE: Detail view is dismissible (click outside or close button)
  // AC4: FE: Unit tests for parameter display
  describe('job parameter detail panel', () => {
    const paramJob: SampleJob = {
      id: 'job-params',
      training_run_name: 'flux/my-run',
      study_id: 'study-abc',
      study_name: 'My Study Preset',
      workflow_name: 'flux-workflow.json',
      vae: 'ae.safetensors',
      clip: 't5xxl.safetensors',
      shift: 1.5,
      status: 'running',
      total_items: 12,
      completed_items: 4,
      failed_items: 0,
      pending_items: 8,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    // AC1: Parameter panel is not visible by default
    it('parameter panel is hidden before the title is clicked', () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      const panel = wrapper.find('[data-testid="job-job-params-params"]')
      expect(panel.exists()).toBe(false)
    })

    // AC1: Clicking the job title reveals the parameter panel
    it('clicking the job title opens the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      const titleBtn = wrapper.find('[data-testid="job-job-params-title"]')
      expect(titleBtn.exists()).toBe(true)
      await titleBtn.trigger('click')
      await nextTick()

      const panel = wrapper.find('[data-testid="job-job-params-params"]')
      expect(panel.exists()).toBe(true)
    })

    // AC2: Training run is displayed in the parameter panel
    it('displays training run name in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const trainingRun = wrapper.find('[data-testid="job-job-params-param-training-run"]')
      expect(trainingRun.exists()).toBe(true)
      expect(trainingRun.text()).toBe('flux/my-run')
    })

    // AC2: Workflow is displayed in the parameter panel
    it('displays workflow name in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const workflow = wrapper.find('[data-testid="job-job-params-param-workflow"]')
      expect(workflow.exists()).toBe(true)
      expect(workflow.text()).toBe('flux-workflow.json')
    })

    // AC2: Study (preset) name is displayed in the parameter panel
    it('displays study (preset) name in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const study = wrapper.find('[data-testid="job-job-params-param-study"]')
      expect(study.exists()).toBe(true)
      expect(study.text()).toBe('My Study Preset')
    })

    // AC2: VAE is displayed in the parameter panel
    it('displays VAE in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const vae = wrapper.find('[data-testid="job-job-params-param-vae"]')
      expect(vae.exists()).toBe(true)
      expect(vae.text()).toBe('ae.safetensors')
    })

    // AC2: CLIP is displayed in the parameter panel
    it('displays CLIP in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const clip = wrapper.find('[data-testid="job-job-params-param-clip"]')
      expect(clip.exists()).toBe(true)
      expect(clip.text()).toBe('t5xxl.safetensors')
    })

    // AC2: Shift is displayed when present
    it('displays shift value when present in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const shift = wrapper.find('[data-testid="job-job-params-param-shift"]')
      expect(shift.exists()).toBe(true)
      expect(shift.text()).toBe('1.5')
    })

    // AC2: Shift row is not shown when shift is undefined
    it('does not display shift row when shift is undefined', async () => {
      const jobWithoutShift: SampleJob = { ...paramJob, id: 'job-no-shift', shift: undefined }
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [jobWithoutShift] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-no-shift-title"]').trigger('click')
      await nextTick()

      const shift = wrapper.find('[data-testid="job-job-no-shift-param-shift"]')
      expect(shift.exists()).toBe(false)
    })

    // AC2: Checkpoint count is displayed in the parameter panel
    it('displays checkpoint count in the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const checkpoints = wrapper.find('[data-testid="job-job-params-param-checkpoints"]')
      expect(checkpoints.exists()).toBe(true)
      expect(checkpoints.text()).toContain('total')
    })

    // AC2: Checkpoint count uses jobProgress.total_checkpoints when available
    it('uses jobProgress total_checkpoints for checkpoint count when available', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [paramJob],
          jobProgress: {
            'job-params': {
              checkpoints_completed: 2,
              total_checkpoints: 6,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()

      const checkpoints = wrapper.find('[data-testid="job-job-params-param-checkpoints"]')
      expect(checkpoints.text()).toContain('6')
    })

    // AC3: Clicking the title again closes the parameter panel (toggle)
    it('clicking the title again closes the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      const titleBtn = wrapper.find('[data-testid="job-job-params-title"]')
      // Open
      await titleBtn.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="job-job-params-params"]').exists()).toBe(true)

      // Close by clicking title again
      await titleBtn.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="job-job-params-params"]').exists()).toBe(false)
    })

    // AC3: Clicking the close button dismisses the parameter panel
    it('clicking the close button dismisses the parameter panel', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      // Open
      await wrapper.find('[data-testid="job-job-params-title"]').trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="job-job-params-params"]').exists()).toBe(true)

      // Close via the X button
      const closeBtn = wrapper.find('[data-testid="job-job-params-params-close"]')
      expect(closeBtn.exists()).toBe(true)
      await closeBtn.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="job-job-params-params"]').exists()).toBe(false)
    })

    // AC1: Title button has aria-expanded attribute for accessibility
    it('title button has aria-expanded attribute reflecting panel state', async () => {
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [paramJob] },
        global: { stubs: { Teleport: true } },
      })

      const titleBtn = wrapper.find('[data-testid="job-job-params-title"]')
      expect(titleBtn.attributes('aria-expanded')).toBe('false')

      await titleBtn.trigger('click')
      await nextTick()
      expect(titleBtn.attributes('aria-expanded')).toBe('true')
    })

    // Each job has its own independent parameter panel state
    it('opening one job param panel does not affect other jobs', async () => {
      const job1: SampleJob = { ...paramJob, id: 'j1' }
      const job2: SampleJob = { ...paramJob, id: 'j2' }
      const wrapper = mount(JobProgressPanel, {
        props: { show: true, jobs: [job1, job2] },
        global: { stubs: { Teleport: true } },
      })

      // Open job 1's panel
      await wrapper.find('[data-testid="job-j1-title"]').trigger('click')
      await nextTick()

      expect(wrapper.find('[data-testid="job-j1-params"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="job-j2-params"]').exists()).toBe(false)
    })
  })

  // AC1 (B-077): Long checkpoint names in the Current checkpoint progress line show ellipsis with a tooltip on hover
  // AC2 (B-077): Tooltip displays the full checkpoint filename
  // AC3 (B-077): Consistent with the tooltip treatment in B-052 completeness section
  describe('current checkpoint tooltip (B-077)', () => {
    const runningJobForTooltip: SampleJob = {
      id: 'job-ckpt-tip',
      training_run_name: 'flux/tooltip-test',
      study_id: 'preset-1', study_name: 'Quick Test',
      workflow_name: 'flux.json',
      vae: 'ae.safetensors',
      clip: 't5.safetensors',
      status: 'running',
      total_items: 10,
      completed_items: 3,
      failed_items: 0,
      pending_items: 7,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }

    // AC1 + AC2: Current checkpoint span has a title attribute with the full filename
    it('current checkpoint span has a title attribute with the full checkpoint name', () => {
      const fullName = 'a-very-long-checkpoint-filename-that-would-overflow.safetensors'
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJobForTooltip],
          jobProgress: {
            'job-ckpt-tip': {
              checkpoints_completed: 1,
              total_checkpoints: 3,
              current_checkpoint: fullName,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      // AC2: title attribute must match the full checkpoint filename
      const ckptSpan = wrapper.find('[data-testid="job-job-ckpt-tip-current-checkpoint"]')
      expect(ckptSpan.exists()).toBe(true)
      expect(ckptSpan.attributes('title')).toBe(fullName)
    })

    // AC3: Span carries the progress-checkpoint class (consistent with completeness-checkpoint treatment)
    it('current checkpoint span has the progress-checkpoint class for ellipsis truncation', () => {
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJobForTooltip],
          jobProgress: {
            'job-ckpt-tip': {
              checkpoints_completed: 1,
              total_checkpoints: 3,
              current_checkpoint: 'short.safetensors',
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const ckptSpan = wrapper.find('[data-testid="job-job-ckpt-tip-current-checkpoint"]')
      expect(ckptSpan.exists()).toBe(true)
      expect(ckptSpan.classes()).toContain('progress-checkpoint')
      // No inline style overrides
      expect(ckptSpan.attributes('style')).toBeUndefined()
    })

    // AC2: Title attribute also present for short names (tooltip is always available)
    it('title attribute is present even for short checkpoint names', () => {
      const shortName = 'ckpt-001.safetensors'
      const wrapper = mount(JobProgressPanel, {
        props: {
          show: true,
          jobs: [runningJobForTooltip],
          jobProgress: {
            'job-ckpt-tip': {
              checkpoints_completed: 0,
              total_checkpoints: 2,
              current_checkpoint: shortName,
            },
          },
        },
        global: { stubs: { Teleport: true } },
      })

      const ckptSpan = wrapper.find('[data-testid="job-job-ckpt-tip-current-checkpoint"]')
      expect(ckptSpan.attributes('title')).toBe(shortName)
    })
  })
})

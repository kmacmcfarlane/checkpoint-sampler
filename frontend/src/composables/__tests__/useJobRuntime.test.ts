import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useJobRuntimes, isTerminalRuntimeStatus } from '../useJobRuntime'
import type { SampleJob } from '../../api/types'

// enableAutoUnmount is configured globally in vitest.setup.ts

function makeJob(overrides: Partial<SampleJob>): SampleJob {
  return {
    id: 'job-1',
    training_run_name: 'run',
    study_id: 'study-1',
    study_name: 'study',
    workflow_name: 'workflow',
    vae: '',
    clip: '',
    checkpoint_filenames: [],
    status: 'running',
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Mount a wrapper component so the composable has access to onUnmounted. */
function mountJobRuntimes(initialJobs: SampleJob[]) {
  const jobs = ref<SampleJob[]>(initialJobs)
  let result!: ReturnType<typeof useJobRuntimes>
  const Wrapper = defineComponent({
    setup() {
      result = useJobRuntimes(jobs)
      return {}
    },
    template: '<div />',
  })
  const wrapper = mount(Wrapper)
  return { wrapper, jobs, result }
}

describe('isTerminalRuntimeStatus', () => {
  it.each([
    ['completed', true],
    ['completed_with_errors', true],
    ['failed', true],
    ['stopped', true],
    ['running', false],
    ['pending', false],
  ] as const)('treats status %s as terminal=%s', (status, expected) => {
    expect(isTerminalRuntimeStatus(status)).toBe(expected)
  })
})

describe('useJobRuntimes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AC: FE: running jobs display a live elapsed timer (now - created_at) that ticks while active
  it('computes live elapsed runtime for a running job as now - created_at', () => {
    const job = makeJob({ status: 'running', created_at: '2026-01-01T00:00:00.000Z' })
    const { result } = mountJobRuntimes([job])
    expect(result.getRuntimeSeconds(job)).toBe(10)
  })

  it('ticks the running job runtime forward every second', async () => {
    const job = makeJob({ status: 'running', created_at: '2026-01-01T00:00:00.000Z' })
    const { jobs, result } = mountJobRuntimes([job])
    expect(result.getRuntimeSeconds(job)).toBe(10)

    vi.advanceTimersByTime(3000)
    // Trigger a reactivity update by touching the jobs ref (no-op reassign not needed;
    // the internal `now` ref update alone drives reactivity for callers reading it).
    jobs.value = [...jobs.value]
    expect(result.getRuntimeSeconds(job)).toBe(13)

    vi.advanceTimersByTime(2000)
    expect(result.getRuntimeSeconds(job)).toBe(15)
  })

  // AC: FE: terminal jobs display a fixed total (updated_at - created_at)
  it('computes a fixed total runtime for a terminal job as updated_at - created_at', () => {
    const job = makeJob({
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:05:00.000Z',
    })
    const { result } = mountJobRuntimes([job])
    expect(result.getRuntimeSeconds(job)).toBe(300)
  })

  it('does not tick a terminal job runtime forward over time', () => {
    const job = makeJob({
      status: 'failed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:05:00.000Z',
    })
    const { result } = mountJobRuntimes([job])
    expect(result.getRuntimeSeconds(job)).toBe(300)

    vi.advanceTimersByTime(60000)
    expect(result.getRuntimeSeconds(job)).toBe(300)
  })

  it.each(['completed_with_errors', 'stopped'] as const)(
    'treats %s status as terminal (fixed, non-ticking) runtime',
    (status) => {
      const job = makeJob({
        status,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:02:00.000Z',
      })
      const { result } = mountJobRuntimes([job])
      expect(result.getRuntimeSeconds(job)).toBe(120)

      vi.advanceTimersByTime(30000)
      expect(result.getRuntimeSeconds(job)).toBe(120)
    },
  )

  it('stops the shared ticker once no jobs are running (does not tick pending job runtime)', () => {
    const job = makeJob({ status: 'pending', created_at: '2026-01-01T00:00:00.000Z' })
    const { result } = mountJobRuntimes([job])
    const before = result.getRuntimeSeconds(job)

    vi.advanceTimersByTime(5000)
    expect(result.getRuntimeSeconds(job)).toBe(before)
  })

  it('stops the timer on unmount', () => {
    const job = makeJob({ status: 'running', created_at: '2026-01-01T00:00:00.000Z' })
    const { wrapper, result } = mountJobRuntimes([job])
    expect(result.getRuntimeSeconds(job)).toBe(10)

    wrapper.unmount()
    vi.advanceTimersByTime(10000)
    // getRuntimeSeconds still computes off `now`, but the ticker no longer advances `now`
    // after unmount, so the value should not have grown by the advanced time.
    expect(result.getRuntimeSeconds(job)).toBe(10)
  })
})

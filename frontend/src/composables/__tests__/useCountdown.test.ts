import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useCountdown, useJobEtaCountdowns } from '../useCountdown'

// enableAutoUnmount is configured globally in vitest.setup.ts

// ─── useCountdown ───────────────────────────────────────────────────────────

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Mount a wrapper component so the composable has access to the full Vue
   * component lifecycle (onUnmounted in particular).
   */
  function mountCountdown(initialEta: number | undefined) {
    const serverEta = ref<number | undefined>(initialEta)
    let result!: ReturnType<typeof useCountdown>
    const Wrapper = defineComponent({
      setup() {
        result = useCountdown(serverEta)
        return {}
      },
      template: '<div />',
    })
    const wrapper = mount(Wrapper)
    return { wrapper, serverEta, result }
  }

  // AC1: Countdown interpolates between WebSocket events
  it('initialises displayEtaSeconds from the server value', () => {
    const { result } = mountCountdown(10)
    expect(result.displayEtaSeconds.value).toBe(10)
  })

  it('counts down by 1 each second', async () => {
    const { result } = mountCountdown(5)
    expect(result.displayEtaSeconds.value).toBe(5)

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(4)

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(3)
  })

  it('reaches zero and stops the interval', async () => {
    const { result } = mountCountdown(2)
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(0)

    // Another second should not go below zero
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBeUndefined()
  })

  // AC2: Countdown resets when a new ETA value arrives from WebSocket
  it('resets countdown when server ETA changes to a new value', async () => {
    const { serverEta, result } = mountCountdown(10)
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(7)

    // New WebSocket event arrives with a fresh ETA
    serverEta.value = 20
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(20)
  })

  it('continues ticking after reset', async () => {
    const { serverEta, result } = mountCountdown(10)
    vi.advanceTimersByTime(3000)
    await nextTick()

    serverEta.value = 15
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(15)

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(14)
  })

  it('sets displayEtaSeconds to undefined when server ETA becomes undefined', async () => {
    const { serverEta, result } = mountCountdown(10)
    expect(result.displayEtaSeconds.value).toBe(10)

    serverEta.value = undefined
    await nextTick()
    expect(result.displayEtaSeconds.value).toBeUndefined()
  })

  it('does not start a countdown for undefined initial ETA', () => {
    const { result } = mountCountdown(undefined)
    expect(result.displayEtaSeconds.value).toBeUndefined()
    vi.advanceTimersByTime(5000)
    expect(result.displayEtaSeconds.value).toBeUndefined()
  })

  it('does not start a countdown for zero initial ETA', () => {
    const { result } = mountCountdown(0)
    expect(result.displayEtaSeconds.value).toBeUndefined()
    vi.advanceTimersByTime(5000)
    expect(result.displayEtaSeconds.value).toBeUndefined()
  })

  // AC3: Timer is cleaned up on component unmount
  it('stops the interval on unmount', async () => {
    const { wrapper, result } = mountCountdown(10)
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(8)

    wrapper.unmount()

    // After unmount, the value should not change
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(result.displayEtaSeconds.value).toBe(8)
  })
})

// ─── useJobEtaCountdowns ────────────────────────────────────────────────────

describe('useJobEtaCountdowns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  type JobProgressMap = Record<string, {
    sample_eta_seconds?: number
    job_eta_seconds?: number
  }>

  function mountJobEtaCountdowns(initialProgress: JobProgressMap | undefined) {
    const jobProgress = ref<JobProgressMap | undefined>(initialProgress)
    let result!: ReturnType<typeof useJobEtaCountdowns>
    const Wrapper = defineComponent({
      setup() {
        result = useJobEtaCountdowns(jobProgress)
        return {}
      },
      template: '<div />',
    })
    const wrapper = mount(Wrapper)
    return { wrapper, jobProgress, result }
  }

  // AC1: Countdown interpolates sample ETA between WebSocket events
  it('initialises sample and job ETAs for a running job', () => {
    const { result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 30, job_eta_seconds: 120 },
    })
    expect(result.getDisplaySampleEta('job-1')).toBe(30)
    expect(result.getDisplayJobEta('job-1')).toBe(120)
  })

  it('counts down sample ETA every second', async () => {
    const { result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
    })
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(7)
  })

  it('counts down job ETA every second', async () => {
    const { result } = mountJobEtaCountdowns({
      'job-1': { job_eta_seconds: 60 },
    })
    vi.advanceTimersByTime(5000)
    await nextTick()
    expect(result.getDisplayJobEta('job-1')).toBe(55)
  })

  it('tracks multiple jobs independently', async () => {
    const { result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
      'job-2': { sample_eta_seconds: 20 },
    })
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(7)
    expect(result.getDisplaySampleEta('job-2')).toBe(17)
  })

  // AC2: Countdown resets when a new ETA value arrives from WebSocket
  it('resets sample ETA countdown when server sends a new value', async () => {
    const { jobProgress, result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
    })
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(6)

    // New WebSocket event with fresh ETA
    jobProgress.value = { 'job-1': { sample_eta_seconds: 25 } }
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(25)
  })

  it('resets job ETA countdown when server sends a new value', async () => {
    const { jobProgress, result } = mountJobEtaCountdowns({
      'job-1': { job_eta_seconds: 60 },
    })
    vi.advanceTimersByTime(10000)
    await nextTick()
    expect(result.getDisplayJobEta('job-1')).toBe(50)

    jobProgress.value = { 'job-1': { job_eta_seconds: 90 } }
    await nextTick()
    expect(result.getDisplayJobEta('job-1')).toBe(90)
  })

  it('continues ticking after reset', async () => {
    const { jobProgress, result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
    })
    vi.advanceTimersByTime(5000)
    await nextTick()

    jobProgress.value = { 'job-1': { sample_eta_seconds: 30 } }
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(30)

    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(28)
  })

  it('clears ETA when server sends undefined', async () => {
    const { jobProgress, result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
    })
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBe(8)

    jobProgress.value = { 'job-1': {} }
    await nextTick()
    expect(result.getDisplaySampleEta('job-1')).toBeUndefined()
  })

  it('returns undefined for unknown job IDs', () => {
    const { result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
    })
    expect(result.getDisplaySampleEta('unknown-job')).toBeUndefined()
    expect(result.getDisplayJobEta('unknown-job')).toBeUndefined()
  })

  it('handles undefined jobProgress gracefully', () => {
    const { result } = mountJobEtaCountdowns(undefined)
    expect(result.getDisplaySampleEta('job-1')).toBeUndefined()
    expect(result.getDisplayJobEta('job-1')).toBeUndefined()
  })

  // AC3: All timers are cleaned up on component unmount
  it('stops all countdowns on unmount', async () => {
    const { wrapper, result } = mountJobEtaCountdowns({
      'job-1': { sample_eta_seconds: 10 },
      'job-2': { job_eta_seconds: 60 },
    })
    vi.advanceTimersByTime(3000)
    await nextTick()
    const sampleBefore = result.getDisplaySampleEta('job-1')
    const jobBefore = result.getDisplayJobEta('job-2')

    wrapper.unmount()

    vi.advanceTimersByTime(5000)
    await nextTick()
    // Values should not change after unmount
    expect(result.getDisplaySampleEta('job-1')).toBe(sampleBefore)
    expect(result.getDisplayJobEta('job-2')).toBe(jobBefore)
  })
})

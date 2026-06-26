import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed, type Ref } from 'vue'
import {
  useSampleAvailability,
  type UseSampleAvailability,
  type TrainingRunStatus,
} from '../useSampleAvailability'
import type {
  TrainingRun,
  Study,
  SampleJob,
  StudyAvailability,
  StudySampleStatus,
  ValidationResult,
} from '../../api/types'

// Mock the api client — only getStudyAvailability is exercised by this composable.
vi.mock('../../api/client', () => ({
  apiClient: {
    getStudyAvailability: vi.fn(),
  },
}))
import { apiClient } from '../../api/client'
const mockGetStudyAvailability = apiClient.getStudyAvailability as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<TrainingRun> = {}): TrainingRun {
  return {
    id: 'run-1',
    name: 'run-a',
    kind: 'checkpoint',
    checkpoint_count: 2,
    has_samples: false,
    checkpoints: [
      { filename: 'chk-1.safetensors', step_number: 1000, has_samples: false },
      { filename: 'chk-2.safetensors', step_number: 2000, has_samples: false },
    ],
    ...overrides,
  }
}

function makeStudy(id: string, name = id): Study {
  return {
    id,
    name,
    prompt_prefix: '',
    prompts: [],
    negative_prompt: '',
    steps: [],
    cfgs: [],
    sampler_scheduler_pairs: [],
    seeds: [],
    width: 1024,
    height: 1024,
    workflow_template: 'qwen-image.json',
    vae: '',
    text_encoder: '',
    lora_strength_pairs: [],
    images_per_checkpoint: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function makeJob(status: SampleJob['status'], opts: { runName?: string; studyId?: string } = {}): SampleJob {
  return {
    id: `job-${status}-${Math.random()}`,
    training_run_name: opts.runName ?? 'run-a',
    study_id: opts.studyId ?? 'study-1',
    study_name: 'Study',
    workflow_name: 'default',
    vae: '',
    clip: '',
    status,
    total_items: 10,
    completed_items: 0,
    failed_items: 0,
    pending_items: 10,
    checkpoint_filenames: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function makeAvail(studyId: string, status: StudySampleStatus, opts: Partial<StudyAvailability> = {}): StudyAvailability {
  return {
    study_id: studyId,
    study_name: studyId,
    has_samples: status !== 'none',
    sample_status: status,
    checkpoints_with_samples: status === 'complete' ? 2 : status === 'partial' ? 1 : 0,
    total_checkpoints: 2,
    ...opts,
  }
}

// Default job-status classifier mirroring JobLaunchDialog.getRunStatus.
function defaultGetRunStatus(jobs: Ref<SampleJob[]>) {
  return (run: TrainingRun): TrainingRunStatus => {
    const runJobs = jobs.value.filter(j => j.training_run_name === run.name)
    if (runJobs.some(j => j.status === 'running')) return 'running'
    if (runJobs.some(j => j.status === 'pending' || j.status === 'stopped')) return 'queued'
    if (runJobs.some(j => j.status === 'completed_with_errors')) return 'partial'
    if (runJobs.some(j => j.status === 'completed')) return 'complete'
    if (run.has_samples) return 'complete'
    return 'empty'
  }
}

interface Harness {
  composable: UseSampleAvailability
  trainingRuns: Ref<TrainingRun[]>
  sampleJobs: Ref<SampleJob[]>
  studies: Ref<Study[]>
  selectedTrainingRunId: Ref<string | null>
  selectedStudy: Ref<string | null>
  validationResult: Ref<ValidationResult | null>
  showAllRuns: Ref<boolean>
}

function setup(init: {
  runs?: TrainingRun[]
  jobs?: SampleJob[]
  studies?: Study[]
  selectedRunId?: string | null
  selectedStudy?: string | null
  showAllRuns?: boolean
  compatible?: (study: Study) => boolean
} = {}): Harness {
  const trainingRuns = ref<TrainingRun[]>(init.runs ?? [])
  const sampleJobs = ref<SampleJob[]>(init.jobs ?? [])
  const studies = ref<Study[]>(init.studies ?? [])
  const selectedTrainingRunId = ref<string | null>(init.selectedRunId ?? null)
  const selectedStudy = ref<string | null>(init.selectedStudy ?? null)
  const validationResult = ref<ValidationResult | null>(null)
  const showAllRuns = ref(init.showAllRuns ?? true)
  const selectedTrainingRun = computed(() =>
    trainingRuns.value.find(r => r.id === selectedTrainingRunId.value) ?? null,
  )

  const composable = useSampleAvailability({
    trainingRuns,
    sampleJobs,
    studies,
    selectedTrainingRunId,
    selectedStudy,
    selectedTrainingRun,
    validationResult,
    showAllRuns,
    getRunStatus: defaultGetRunStatus(sampleJobs),
    isStudyCompatibleWithRunKind: init.compatible ?? (() => true),
  })

  return {
    composable,
    trainingRuns,
    sampleJobs,
    studies,
    selectedTrainingRunId,
    selectedStudy,
    validationResult,
    showAllRuns,
  }
}

beforeEach(() => {
  mockGetStudyAvailability.mockReset()
})

// ---------------------------------------------------------------------------
// trainingRunOptions — PRD 5.5.1 training-run bead precedence
// ---------------------------------------------------------------------------

describe('useSampleAvailability.trainingRunOptions', () => {
  it('respects the showAllRuns filter (only empty runs when false)', () => {
    const runEmpty = makeRun({ id: 'run-1', name: 'empty', has_samples: false })
    const runWithSamples = makeRun({ id: 'run-2', name: 'withSamples', has_samples: true })
    const h = setup({ runs: [runEmpty, runWithSamples], showAllRuns: false })
    const labels = h.composable.trainingRunOptions.value.map(o => o.label)
    expect(labels).toEqual(['empty'])
  })

  it('shows all runs when showAllRuns is true', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'a', has_samples: false }), makeRun({ id: 'run-2', name: 'b', has_samples: true })],
      showAllRuns: true,
    })
    expect(h.composable.trainingRunOptions.value.map(o => o.label)).toEqual(['a', 'b'])
  })

  // AC: PRD 5.5.1 training-run bead precedence table
  // [jobs, study statuses] → expected dual bead
  it.each([
    {
      name: 'blue when a job is running (blue wins over green)',
      jobs: [makeJob('running')], statuses: ['complete' as const, 'complete' as const],
      activity: 'blue', problem: null,
    },
    {
      name: 'blue when a job is pending',
      jobs: [makeJob('pending')], statuses: [],
      activity: 'blue', problem: null,
    },
    {
      name: 'green when all studies complete and no running jobs',
      jobs: [], statuses: ['complete' as const, 'complete' as const],
      activity: 'green', problem: null,
    },
    {
      name: 'no green when any study partial',
      jobs: [], statuses: ['complete' as const, 'partial' as const],
      activity: null, problem: 'yellow',
    },
    {
      name: 'red when a job failed (red wins over yellow)',
      jobs: [makeJob('failed')], statuses: ['partial' as const],
      activity: null, problem: 'red',
    },
    {
      name: 'red when completed_with_errors',
      jobs: [makeJob('completed_with_errors')], statuses: [],
      activity: null, problem: 'red',
    },
    {
      name: 'yellow when partial study status and no running jobs',
      jobs: [], statuses: ['partial' as const, 'none' as const],
      activity: null, problem: 'yellow',
    },
    {
      name: 'yellow suppressed when a job is running',
      jobs: [makeJob('running')], statuses: ['partial' as const],
      activity: 'blue', problem: null,
    },
  ])('$name', ({ jobs, statuses, activity, problem }) => {
    const run = makeRun({ id: 'run-1', name: 'run-a', has_samples: false })
    const h = setup({ runs: [run], jobs, selectedRunId: 'run-1' })
    // Selected-run beads read from studyAvailability; build one entry per status.
    h.composable.studyAvailability.value = statuses.map((s, i) => makeAvail(`s-${i}`, s))
    const opt = h.composable.trainingRunOptions.value[0]
    expect(opt._dualBead.activity).toBe(activity)
    expect(opt._dualBead.problem).toBe(problem)
  })

  it('uses allRunsAvailability for non-selected runs', () => {
    const selected = makeRun({ id: 'run-1', name: 'selected' })
    const other = makeRun({ id: 'run-2', name: 'other' })
    const h = setup({ runs: [selected, other], selectedRunId: 'run-1' })
    // Other run is green via allRunsAvailability (all complete)
    h.composable.allRunsAvailability.value = new Map([['run-2', [makeAvail('s-0', 'complete')]]])
    const otherOpt = h.composable.trainingRunOptions.value.find(o => o.value === 'run-2')!
    expect(otherOpt._dualBead.activity).toBe('green')
  })

  // S-116: validation refinement on the selected run's selected study
  it('S-116: refines complete→partial for the selected study when validation shows missing files', () => {
    const run = makeRun({ id: 'run-1', name: 'run-a' })
    const h = setup({ runs: [run], selectedRunId: 'run-1', selectedStudy: 'study-1' })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'complete')]
    h.validationResult.value = { total_missing: 5 } as ValidationResult
    const opt = h.composable.trainingRunOptions.value[0]
    // complete refined to partial → yellow problem, no green activity
    expect(opt._dualBead.activity).toBeNull()
    expect(opt._dualBead.problem).toBe('yellow')
  })
})

// ---------------------------------------------------------------------------
// studyOptions — PRD 5.5.1 study bead precedence
// ---------------------------------------------------------------------------

describe('useSampleAvailability.studyOptions', () => {
  it.each([
    { name: 'blue when running (blue wins over green)', status: 'complete' as const, jobStatus: 'running' as const, activity: 'blue', problem: null },
    { name: 'green when complete and no running jobs', status: 'complete' as const, jobStatus: null, activity: 'green', problem: null },
    { name: 'red when failed (red wins over yellow)', status: 'partial' as const, jobStatus: 'failed' as const, activity: null, problem: 'red' },
    { name: 'yellow when partial and no running jobs', status: 'partial' as const, jobStatus: null, activity: null, problem: 'yellow' },
    { name: 'no beads when none', status: 'none' as const, jobStatus: null, activity: null, problem: null },
  ])('$name', ({ status, jobStatus, activity, problem }) => {
    const jobs = jobStatus ? [makeJob(jobStatus, { runName: 'run-a', studyId: 'study-1' })] : []
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      jobs,
      selectedRunId: 'run-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', status)]
    const opt = h.composable.studyOptions.value[0]
    expect(opt._dualBead.activity).toBe(activity)
    expect(opt._dualBead.problem).toBe(problem)
  })

  it('S-116: refines complete→partial bead for the selected study with missing validation', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'complete')]
    h.validationResult.value = { total_missing: 3 } as ValidationResult
    const opt = h.composable.studyOptions.value[0]
    expect(opt._sampleStatus).toBe('partial')
    expect(opt._dualBead.problem).toBe('yellow')
  })

  it('does NOT refine a non-selected study even with missing validation', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1'), makeStudy('study-2')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'complete'), makeAvail('study-2', 'complete')]
    h.validationResult.value = { total_missing: 3 } as ValidationResult
    const study2 = h.composable.studyOptions.value.find(o => o.value === 'study-2')!
    expect(study2._sampleStatus).toBe('complete')
    expect(study2._dualBead.activity).toBe('green')
  })

  it('exposes checkpoint counts for tooltips', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'partial', { checkpoints_with_samples: 1, total_checkpoints: 4 })]
    expect(h.composable.studyOptions.value[0]._checkpointCounts).toEqual({ withSamples: 1, total: 4 })
  })

  it('B-140: marks incompatible studies via the compatibility predicate', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
      compatible: () => false,
    })
    expect(h.composable.studyOptions.value[0]._compatible).toBe(false)
  })

  it('yields neutral beads when no training run is selected', () => {
    const h = setup({ studies: [makeStudy('study-1')] })
    const opt = h.composable.studyOptions.value[0]
    expect(opt._dualBead).toEqual({ activity: null, problem: null })
  })
})

// ---------------------------------------------------------------------------
// selectedRunHasSamples
// ---------------------------------------------------------------------------

describe('useSampleAvailability.selectedRunHasSamples', () => {
  it('is false when no run selected', () => {
    const h = setup({ runs: [makeRun({ id: 'run-1' })] })
    expect(h.composable.selectedRunHasSamples.value).toBe(false)
  })

  it.each([
    { status: 'complete', has: true },
    { status: 'partial', has: true },
    { status: 'running', has: true },
    { status: 'queued', has: true },
    { status: 'empty', has: false },
  ])('run status $status → hasSamples=$has', ({ status, has }) => {
    // Drive getRunStatus via jobs / has_samples
    const jobs: SampleJob[] = []
    let hasSamples = false
    if (status === 'running') jobs.push(makeJob('running'))
    else if (status === 'queued') jobs.push(makeJob('pending'))
    else if (status === 'partial') jobs.push(makeJob('completed_with_errors'))
    else if (status === 'complete') hasSamples = true
    const h = setup({ runs: [makeRun({ id: 'run-1', name: 'run-a', has_samples: hasSamples })], jobs, selectedRunId: 'run-1' })
    expect(h.composable.selectedRunHasSamples.value).toBe(has)
  })
})

// ---------------------------------------------------------------------------
// selectedStudyHasSamples
// ---------------------------------------------------------------------------

describe('useSampleAvailability.selectedStudyHasSamples', () => {
  it('is false when no run or no study selected', () => {
    const h = setup({ runs: [makeRun({ id: 'run-1' })], selectedRunId: 'run-1' })
    expect(h.composable.selectedStudyHasSamples.value).toBe(false)
  })

  it('is true when availability for the study reports non-none status', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'partial')]
    expect(h.composable.selectedStudyHasSamples.value).toBe(true)
  })

  it('availability=none but active job for the study → true', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      jobs: [makeJob('running', { runName: 'run-a', studyId: 'study-1' })],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'none')]
    expect(h.composable.selectedStudyHasSamples.value).toBe(true)
  })

  it('availability=none and no active job → false', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a' })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    h.composable.studyAvailability.value = [makeAvail('study-1', 'none')]
    expect(h.composable.selectedStudyHasSamples.value).toBe(false)
  })

  it('falls back to run-level status while availability is still loading (empty array)', () => {
    // Run has samples (green via has_samples) but studyAvailability not loaded yet
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a', has_samples: true })],
      studies: [makeStudy('study-1')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-1',
    })
    // studyAvailability.value stays [] (loading)
    expect(h.composable.selectedStudyHasSamples.value).toBe(true)
  })

  it('availability loaded but study absent (newly created) → checks jobs only', () => {
    const h = setup({
      runs: [makeRun({ id: 'run-1', name: 'run-a', has_samples: true })],
      studies: [makeStudy('study-2')],
      selectedRunId: 'run-1',
      selectedStudy: 'study-2',
    })
    // Availability has another study but not study-2 → not loading, no jobs → false
    h.composable.studyAvailability.value = [makeAvail('study-1', 'complete')]
    expect(h.composable.selectedStudyHasSamples.value).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

describe('useSampleAvailability fetch helpers', () => {
  it('fetchSelectedRunAvailability populates studyAvailability + allRunsAvailability', async () => {
    const avail = [makeAvail('study-1', 'complete')]
    mockGetStudyAvailability.mockResolvedValueOnce(avail)
    const h = setup({ runs: [makeRun({ id: 'run-7', name: 'run-a' })] })
    await h.composable.fetchSelectedRunAvailability('run-7')
    expect(h.composable.studyAvailability.value).toEqual(avail)
    expect(h.composable.allRunsAvailability.value.get('run-7')).toEqual(avail)
  })

  it('fetchSelectedRunAvailability clears studyAvailability on error', async () => {
    mockGetStudyAvailability.mockRejectedValueOnce(new Error('boom'))
    const h = setup({ runs: [makeRun({ id: 'run-7' })] })
    h.composable.studyAvailability.value = [makeAvail('stale', 'complete')]
    await h.composable.fetchSelectedRunAvailability('run-7')
    expect(h.composable.studyAvailability.value).toEqual([])
  })

  it('fetchAllRunsAvailability builds the per-run map (empty array on per-run failure)', async () => {
    mockGetStudyAvailability
      .mockResolvedValueOnce([makeAvail('s', 'complete')])
      .mockRejectedValueOnce(new Error('boom'))
    const h = setup()
    await h.composable.fetchAllRunsAvailability([makeRun({ id: 'run-1' }), makeRun({ id: 'run-2' })])
    expect(h.composable.allRunsAvailability.value.get('run-1')).toHaveLength(1)
    expect(h.composable.allRunsAvailability.value.get('run-2')).toEqual([])
  })

  it('resetSelectedAvailability clears studyAvailability', () => {
    const h = setup()
    h.composable.studyAvailability.value = [makeAvail('s', 'complete')]
    h.composable.resetSelectedAvailability()
    expect(h.composable.studyAvailability.value).toEqual([])
  })
})

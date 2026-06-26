import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type {
  TrainingRun,
  Study,
  SampleJob,
  StudyAvailability,
  StudySampleStatus,
  ValidationResult,
} from '../api/types'
import { apiClient } from '../api/client'
import { getTrainingRunDualBead, getStudyDualBead, type DualBead } from './dualBeadStatus'

/** Run-level status used to gate checkpoint-picker visibility and "has samples" checks. */
export type TrainingRunStatus = 'complete' | 'partial' | 'running' | 'queued' | 'empty'

/**
 * A training-run dropdown option enriched with dual-bead metadata for renderLabel.
 * The index signature keeps it assignable to Naive UI's SelectMixedOption.
 */
export interface TrainingRunOption {
  label: string
  value: number
  _dualBead: DualBead
  _kind: TrainingRun['kind']
  [key: string]: unknown
}

/**
 * A study dropdown option enriched with dual-bead and compatibility metadata.
 * The index signature keeps it assignable to Naive UI's SelectMixedOption.
 */
export interface StudyOption {
  label: string
  value: string
  _sampleStatus: StudySampleStatus
  _dualBead: DualBead
  _checkpointCounts: { withSamples: number; total: number } | null
  _compatible: boolean
  [key: string]: unknown
}

/**
 * Dependencies the composable reads from the host component (JobLaunchDialog).
 *
 * These are component-owned reactive values shared with other concerns
 * (selection state, the job list, validation preview), passed in rather than
 * owned so the composable stays focused on availability + bead derivation.
 */
export interface UseSampleAvailabilityOptions {
  trainingRuns: Ref<TrainingRun[]>
  sampleJobs: Ref<SampleJob[]>
  studies: Ref<Study[]>
  selectedTrainingRunId: Ref<number | null>
  selectedStudy: Ref<string | null>
  selectedTrainingRun: ComputedRef<TrainingRun | null>
  validationResult: Ref<ValidationResult | null>
  showAllRuns: Ref<boolean>
  /** Per-run status classifier (job-based with has_samples fallback). */
  getRunStatus: (run: TrainingRun) => TrainingRunStatus
  /** B-140 study/run-kind compatibility check used to grey out incompatible studies. */
  isStudyCompatibleWithRunKind: (study: Study) => boolean
}

export interface UseSampleAvailability {
  /** Study availability for the currently selected training run. */
  studyAvailability: Ref<StudyAvailability[]>
  /** Availability for all runs, keyed by run id (used for non-selected run beads). */
  allRunsAvailability: Ref<Map<number, StudyAvailability[]>>
  /** Training-run dropdown options with bead metadata (filtered by showAllRuns). */
  trainingRunOptions: ComputedRef<TrainingRunOption[]>
  /** Study dropdown options with bead + compatibility metadata. */
  studyOptions: ComputedRef<StudyOption[]>
  /** Whether the selected run has any existing samples or active jobs (run-level). */
  selectedRunHasSamples: ComputedRef<boolean>
  /** Whether the selected study has any existing samples or active jobs (study-scoped). */
  selectedStudyHasSamples: ComputedRef<boolean>
  /** Fetch availability for the selected run; updates studyAvailability + allRunsAvailability. */
  fetchSelectedRunAvailability: (runId: number) => Promise<void>
  /** Fetch availability for every run in parallel; populates allRunsAvailability. */
  fetchAllRunsAvailability: (runs: TrainingRun[]) => Promise<void>
  /** Clear selected-run availability (called when the run changes before re-fetching). */
  resetSelectedAvailability: () => void
}

/**
 * Owns study-sample availability state and the bead/availability derivations for
 * the Generate Samples dialog. Extracted from JobLaunchDialog (R-019) to encode
 * the PRD 5.5.1 bead precedence table (via dualBeadStatus) plus the S-116
 * validation-refinement rule in one tested place, and to let the dialog collapse
 * its previously-separate selectedTrainingRunId watchers into a single one.
 *
 * Behavior-preserving: the option-shaping, S-116 refinement, and run/study
 * "has samples" fallbacks are copied verbatim from the original component.
 */
export function useSampleAvailability(options: UseSampleAvailabilityOptions): UseSampleAvailability {
  const {
    trainingRuns,
    sampleJobs,
    studies,
    selectedTrainingRunId,
    selectedStudy,
    selectedTrainingRun,
    validationResult,
    showAllRuns,
    getRunStatus,
    isStudyCompatibleWithRunKind,
  } = options

  // Study sample availability for the selected training run
  const studyAvailability = ref<StudyAvailability[]>([])
  const allRunsAvailability = ref<Map<number, StudyAvailability[]>>(new Map())

  // Training run select options (filtered by showAllRuns)
  // Each option includes _dualBead metadata for the renderLabel function.
  const trainingRunOptions = computed<TrainingRunOption[]>(() => {
    return trainingRuns.value
      .filter(run => {
        if (showAllRuns.value) return true
        return getRunStatus(run) === 'empty'
      })
      .map(run => {
        // Use all-runs availability map for bead rendering.
        // For the selected run, prefer the more-current studyAvailability (updated by the watcher).
        const availData = run.id === selectedTrainingRunId.value
          ? studyAvailability.value
          : (allRunsAvailability.value.get(run.id) ?? [])
        // UAT fix (S-116): Refine study statuses for the selected run using validation data.
        // Same logic as the study bead override: if validation shows missing files for the
        // selected study but availability says 'complete', treat it as 'partial'.
        const studyStatuses = availData.map(a => {
          if (
            run.id === selectedTrainingRunId.value &&
            a.study_id === selectedStudy.value &&
            validationResult.value &&
            a.sample_status === 'complete' &&
            validationResult.value.total_missing > 0
          ) {
            return 'partial' as const
          }
          return a.sample_status
        })
        const dualBead = getTrainingRunDualBead(run.name, sampleJobs.value, studyStatuses)

        return {
          label: run.name,
          value: run.id,
          // Custom rendering via renderLabel
          _dualBead: dualBead,
          _kind: run.kind,
        }
      })
  })

  // Whether the selected run has any existing samples or active jobs (run-level check).
  // Used for checkpoint picker visibility, auto-selection, confirmation dialog, and payload construction.
  const selectedRunHasSamples = computed(() => {
    const run = selectedTrainingRun.value
    if (!run) return false
    const status = getRunStatus(run)
    return status === 'complete' || status === 'partial' || status === 'running' || status === 'queued'
  })

  // Whether the selected study (sampleset) has any existing samples or active jobs for the selected training run.
  // Scoped to the selected study so the button label accurately reflects whether THIS study has samples,
  // not whether the training run has samples for any other study.
  // Used ONLY for the button label ('Generate Samples' vs 'Regenerate Samples').
  //
  // When study availability data has loaded for the selected study, this check is definitive.
  // While availability is still loading (studyAvailability is empty), falls back to the run-level
  // check to avoid label flicker — the label updates reactively once availability data arrives.
  const selectedStudyHasSamples = computed(() => {
    const run = selectedTrainingRun.value
    if (!run) return false
    const studyId = selectedStudy.value
    if (!studyId) return false

    // Check directory-level availability for the selected study (available after async fetch)
    const avail = studyAvailability.value.find(a => a.study_id === studyId)
    if (avail) {
      // Availability data is present — use it definitively
      if (avail.sample_status !== 'none') return true
      // Availability says 'none'; also check for active jobs scoped to this study
      const studyJobs = sampleJobs.value.filter(
        j => j.training_run_name === run.name && j.study_id === studyId,
      )
      return studyJobs.some(j => j.status === 'running' || j.status === 'pending' || j.status === 'stopped')
    }

    // Study not found in availability data. Two cases:
    // 1. studyAvailability is empty: data has not loaded yet — fall back to run-level to avoid
    //    label flicker while the async fetch is in-flight. The computed re-evaluates reactively
    //    once the fetch resolves.
    // 2. studyAvailability has entries but not for this study: data has loaded and this study
    //    simply has no samples (e.g. it was just created). Check active jobs only.
    if (studyAvailability.value.length === 0) {
      // Data still loading — use run-level as a transient placeholder
      return getRunStatus(run) === 'complete' || getRunStatus(run) === 'partial' ||
        getRunStatus(run) === 'running' || getRunStatus(run) === 'queued'
    }

    // Data loaded but study not in results — newly created study with no samples. Check jobs only.
    const studyJobs = sampleJobs.value.filter(
      j => j.training_run_name === run.name && j.study_id === studyId,
    )
    return studyJobs.some(j => j.status === 'running' || j.status === 'pending' || j.status === 'stopped')
  })

  // Study options include sample availability info and job status for dual-bead rendering.
  // When a training run is selected:
  //   Slot 1 (activity): blue = running/pending job for this study, green = sample_status='complete'
  //   Slot 2 (problem):  red = failed job for this study, yellow = sample_status='partial' without running jobs
  //
  // NOTE: Bead status uses studyAvailability data (directory-level) as the baseline,
  // with validation-level refinement for the selected study. When the selected study's
  // availability says 'complete' but validation reveals missing files, the bead status
  // is refined to 'partial' (S-116 UAT fix). Non-selected studies use availability only.
  const studyOptions = computed<StudyOption[]>(() => {
    const runName = selectedTrainingRun.value?.name ?? ''

    return studies.value.map(p => {
      const avail = studyAvailability.value.find(a => a.study_id === p.id)
      let sampleStatus = avail?.sample_status ?? 'none'

      // UAT fix (S-116): Refine bead status for the selected study using validation
      // results. The availability API only checks whether checkpoint directories exist,
      // not whether all expected files are present. When validation shows missing files
      // (total_missing > 0) but availability reports 'complete' (all dirs exist), override
      // to 'partial' so the bead correctly shows yellow instead of green.
      if (
        p.id === selectedStudy.value &&
        validationResult.value &&
        sampleStatus === 'complete' &&
        validationResult.value.total_missing > 0
      ) {
        sampleStatus = 'partial'
      }

      // Compute dual-bead for this study. Only possible when a training run is selected.
      const dualBead = runName
        ? getStudyDualBead(runName, p.id, sampleJobs.value, sampleStatus)
        : { activity: null, problem: null }

      // Checkpoint counts for tooltip
      const checkpointCounts = avail
        ? { withSamples: avail.checkpoints_with_samples, total: avail.total_checkpoints }
        : null

      // B-140: Check if this study's workflow is compatible with the selected run kind
      const compatible = isStudyCompatibleWithRunKind(p)

      return {
        label: p.name,
        value: p.id,
        // Metadata for bead rendering
        _sampleStatus: sampleStatus,
        _dualBead: dualBead,
        _checkpointCounts: checkpointCounts,
        // B-140: Compatibility metadata
        _compatible: compatible,
      }
    })
  })

  /** Fetch availability for all training runs in parallel; awaited by fetchTrainingRunsAndJobs. */
  async function fetchAllRunsAvailability(runs: TrainingRun[]): Promise<void> {
    const entries = await Promise.all(
      runs.map(async (run): Promise<[number, StudyAvailability[]]> => {
        try {
          const avail = await apiClient.getStudyAvailability(run.id)
          return [run.id, avail]
        } catch {
          return [run.id, []]
        }
      }),
    )
    allRunsAvailability.value = new Map(entries)
  }

  /**
   * Fetch study availability for the selected run and keep allRunsAvailability in
   * sync for consistent bead rendering. Non-fatal: on failure studyAvailability is
   * left cleared so the UI degrades to the run-level fallback path.
   */
  async function fetchSelectedRunAvailability(runId: number): Promise<void> {
    try {
      const avail = await apiClient.getStudyAvailability(runId)
      studyAvailability.value = avail
      // Keep allRunsAvailability in sync for consistent bead rendering
      allRunsAvailability.value = new Map(allRunsAvailability.value).set(runId, avail)
    } catch {
      // Non-fatal; proceed without availability data
      studyAvailability.value = []
    }
  }

  /** Clear selected-run availability (called when the run changes before re-fetching). */
  function resetSelectedAvailability(): void {
    studyAvailability.value = []
  }

  return {
    studyAvailability,
    allRunsAvailability,
    trainingRunOptions,
    studyOptions,
    selectedRunHasSamples,
    selectedStudyHasSamples,
    fetchSelectedRunAvailability,
    fetchAllRunsAvailability,
    resetSelectedAvailability,
  }
}

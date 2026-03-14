import type { SampleJob, StudySampleStatus } from '../api/types'

/**
 * Dual-bead status system for the Generate Samples dialog.
 *
 * Each item (training run or study) shows up to two independent beads:
 *   Slot 1 (blue/green): activity indicator
 *   Slot 2 (red/yellow): problem indicator
 *
 * Both slots are independent — an item can have 0, 1, or 2 beads.
 */

/** Possible values for the blue/green bead slot (slot 1). */
export type ActivityBead = 'blue' | 'green' | null

/** Possible values for the red/yellow bead slot (slot 2). */
export type ProblemBead = 'red' | 'yellow' | null

/** The two-bead state for a single item. */
export interface DualBead {
  /** Slot 1: blue (running) > green (all complete). Null when neither applies. */
  activity: ActivityBead
  /** Slot 2: red (failed with missing samples) > yellow (incomplete without running jobs). Null when neither applies. */
  problem: ProblemBead
}

/**
 * Compute dual-bead state for a training run in the Generate Samples dialog.
 *
 * Considers all jobs across all studies for the given training run.
 *
 * Training Run Bead Rules:
 *   Slot 1 (blue/green):
 *     - Blue: any job for this run is running or pending
 *     - Green: at least one study has complete samples AND no studies have partial samples
 *     - Blue wins over green
 *   Slot 2 (red/yellow):
 *     - Red: any job for this run has status 'failed'
 *     - Yellow: any study has sample_status='partial', provided no running jobs exist
 *     - Red wins over yellow
 *
 * @param trainingRunName - The training run name to filter jobs by
 * @param jobs - All sample jobs (will be filtered to this training run)
 * @param studyStatuses - Sample status values for all studies for this training run (from
 *   availability API). Pass empty array when availability data is not available.
 */
export function getTrainingRunDualBead(
  trainingRunName: string,
  jobs: SampleJob[],
  studyStatuses: StudySampleStatus[],
): DualBead {
  const runJobs = jobs.filter(j => j.training_run_name === trainingRunName)

  // --- Slot 1: Activity (blue/green) ---
  const hasRunning = runJobs.some(j => j.status === 'running' || j.status === 'pending')
  // Green from availability: at least one study complete AND no studies partial
  const anyComplete = studyStatuses.some(s => s === 'complete')
  const anyPartial = studyStatuses.some(s => s === 'partial')
  const showGreen = anyComplete && !anyPartial

  let activity: ActivityBead = null
  if (hasRunning) {
    activity = 'blue'
  } else if (showGreen) {
    activity = 'green'
  }

  // --- Slot 2: Problem (red/yellow) ---
  const hasFailed = runJobs.some(j => j.status === 'failed')
  const hasStudyPartial = anyPartial
  const hasRunningForYellow = runJobs.some(j => j.status === 'running' || j.status === 'pending')

  let problem: ProblemBead = null
  if (hasFailed) {
    problem = 'red'
  } else if (hasStudyPartial && !hasRunningForYellow) {
    // Yellow: incomplete sample sets without running jobs
    problem = 'yellow'
  }

  return { activity, problem }
}

/**
 * Compute dual-bead state for a study in the Generate Samples dialog.
 *
 * Considers only jobs for the specific training run × study combination.
 *
 * Study Bead Rules:
 *   Slot 1 (blue/green):
 *     - Blue: any job for this training run × study is running or pending
 *     - Green: sample_status for this study is 'complete'
 *     - Blue wins over green
 *   Slot 2 (red/yellow):
 *     - Red: any job for this training run × study has status 'failed'
 *     - Yellow: sample_status is 'partial' and no running jobs for this study
 *     - Red wins over yellow
 *
 * @param trainingRunName - The training run name
 * @param studyId - The study ID
 * @param jobs - All sample jobs (will be filtered to this training run × study)
 * @param sampleStatus - The sample completeness status for this study × training run
 */
export function getStudyDualBead(
  trainingRunName: string,
  studyId: string,
  jobs: SampleJob[],
  sampleStatus: StudySampleStatus,
): DualBead {
  const studyJobs = jobs.filter(
    j => j.training_run_name === trainingRunName && j.study_id === studyId,
  )

  // --- Slot 1: Activity (blue/green) ---
  const hasRunning = studyJobs.some(j => j.status === 'running' || j.status === 'pending')
  const isComplete = sampleStatus === 'complete'

  let activity: ActivityBead = null
  if (hasRunning) {
    activity = 'blue'
  } else if (isComplete) {
    activity = 'green'
  }

  // --- Slot 2: Problem (red/yellow) ---
  const hasFailed = studyJobs.some(j => j.status === 'failed')
  const hasPartial = sampleStatus === 'partial'
  const hasRunningForYellow = studyJobs.some(j => j.status === 'running' || j.status === 'pending')

  let problem: ProblemBead = null
  if (hasFailed) {
    problem = 'red'
  } else if (hasPartial && !hasRunningForYellow) {
    problem = 'yellow'
  }

  return { activity, problem }
}

/**
 * CSS variable-based color map for dual-bead rendering.
 * Values are hex codes; these are used in inline styles via renderLabel
 * (VNodes rendered outside scoped CSS context cannot use CSS class variables).
 */
export const DUAL_BEAD_COLORS = {
  blue: '#2080f0',   // running/pending
  green: '#18a058',  // complete
  yellow: '#f0a020', // partial/incomplete
  red: '#d03050',    // failed
} as const

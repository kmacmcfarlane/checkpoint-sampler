<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NButton, NTag, NEmpty, NSpin, NCollapse, NCollapseItem } from 'naive-ui'
import type { ValidationResult, CheckpointCompletenessInfo, SampleJob } from '../api/types'

const props = defineProps<{
  show: boolean
  /** Validation results to display, or null when loading. */
  result: ValidationResult | null
  /** Error message if validation failed. */
  error: string | null
  /** Whether the validation request is in progress. */
  loading: boolean
  /** The job being validated (used for Regenerate button). */
  job: SampleJob | null
  /** Title to show in the dialog header. */
  title?: string
}>()

// close: Emitted when the dialog is dismissed.
// regenerate: Emitted when the user clicks Regenerate. Payload: the job whose settings should be prefilled.
const emit = defineEmits<{
  close: []
  regenerate: [job: SampleJob]
}>()

/** Determines the overall status icon/class for a checkpoint row. */
function getCheckpointStatus(cp: CheckpointCompletenessInfo): 'pass' | 'warning' {
  return cp.missing === 0 && cp.extra === 0 && cp.invalid_params === 0 ? 'pass' : 'warning'
}

function hasAnyIssues(): boolean {
  if (!props.result) return false
  return props.result.total_missing > 0 || props.result.total_extra > 0 || props.result.total_invalid_params > 0
}

/** Returns a summary tag label and variant based on the overall validation status. */
function validationStatusLabel(): { type: 'success' | 'warning'; text: string } {
  const r = props.result!
  const issues: string[] = []
  if (r.total_missing > 0) issues.push(`${r.total_missing} missing`)
  if (r.total_extra > 0) issues.push(`${r.total_extra} extra`)
  if (r.total_invalid_params > 0) issues.push(`${r.total_invalid_params} param mismatch`)
  if (issues.length === 0) return { type: 'success', text: 'Complete' }
  return { type: 'warning', text: issues.join(', ') }
}

/** File-type-level breakdown for a single checkpoint. */
interface FileTypeBreakdown {
  label: string
  expected: number
  valid: number
  missing: number
  invalid: number
}

/** Compute per-file-type breakdown for a checkpoint.
 * PNG samples: expected/verified/missing derived from checkpoint fields.
 * JSON metadata: expected = same as PNG expected (one sidecar per sample),
 *   invalid = invalid_params, valid = verified (those verified had matching sidecars).
 */
function getFileTypeBreakdown(cp: CheckpointCompletenessInfo): FileTypeBreakdown[] {
  return [
    {
      label: 'PNG samples',
      expected: cp.expected,
      valid: cp.verified,
      missing: cp.missing,
      invalid: 0,
    },
    {
      label: 'JSON metadata',
      expected: cp.expected,
      valid: cp.verified,
      missing: cp.missing,
      invalid: cp.invalid_params,
    },
  ]
}

/** Summary-level file type breakdown across all checkpoints. */
const summaryBreakdown = computed<FileTypeBreakdown[]>(() => {
  if (!props.result) return []
  return [
    {
      label: 'PNG samples',
      expected: props.result.total_expected,
      valid: props.result.total_verified,
      missing: props.result.total_missing,
      invalid: 0,
    },
    {
      label: 'JSON metadata',
      expected: props.result.total_expected,
      valid: props.result.total_verified,
      missing: props.result.total_missing,
      invalid: props.result.total_invalid_params,
    },
  ]
})

/** Checkpoints that have issues, for auto-expanding in the collapse. */
const expandedCheckpoints = computed<string[]>(() => {
  if (!props.result) return []
  return props.result.checkpoints
    .filter(cp => getCheckpointStatus(cp) === 'warning')
    .map(cp => cp.checkpoint)
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="title ?? 'Validation Results'"
    style="max-width: 700px; max-height: 80vh; overflow-y: auto;"
    data-testid="validation-results-dialog"
    @update:show="emit('close')"
  >
    <template #header-extra>
      <NButton
        v-if="job"
        size="small"
        type="primary"
        data-testid="validation-regenerate-button"
        @click="emit('regenerate', job)"
      >
        Regenerate
      </NButton>
    </template>

    <NSpin :show="loading">
      <div v-if="error" class="validation-error" data-testid="validation-dialog-error" role="alert">
        {{ error }}
      </div>

      <NEmpty
        v-else-if="!loading && !result"
        description="No validation results available"
      />

      <template v-else-if="result">
        <!-- Summary section -->
        <div class="validation-summary" data-testid="validation-dialog-summary">
          <div class="validation-summary-header">
            <span class="validation-summary-label">Total:</span>
            <span>
              {{ result.total_actual }} / {{ result.total_expected }} samples
            </span>
            <NTag
              :type="validationStatusLabel().type"
              size="small"
              :data-testid="validationStatusLabel().type === 'success' ? 'validation-dialog-status-complete' : 'validation-dialog-status-issues'"
            >
              {{ validationStatusLabel().text }}
            </NTag>
          </div>

          <!-- Summary file-type breakdown table -->
          <table class="validation-breakdown-table" data-testid="validation-summary-breakdown">
            <thead>
              <tr>
                <th>File Type</th>
                <th>Expected</th>
                <th>Valid</th>
                <th>Missing</th>
                <th>Invalid</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ft in summaryBreakdown"
                :key="ft.label"
                :data-testid="`validation-summary-ft-${ft.label.toLowerCase().replace(/\s+/g, '-')}`"
              >
                <td>{{ ft.label }}</td>
                <td>{{ ft.expected }}</td>
                <td>{{ ft.valid }}</td>
                <td :class="{ 'count-warning': ft.missing > 0 }">{{ ft.missing }}</td>
                <td :class="{ 'count-error': ft.invalid > 0 }">{{ ft.invalid }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr data-testid="validation-summary-totals">
                <td><strong>Totals</strong></td>
                <td><strong>{{ result.total_expected }}</strong></td>
                <td><strong>{{ result.total_verified }}</strong></td>
                <td :class="{ 'count-warning': result.total_missing > 0 }"><strong>{{ result.total_missing }}</strong></td>
                <td :class="{ 'count-error': result.total_invalid_params > 0 }"><strong>{{ result.total_invalid_params }}</strong></td>
              </tr>
            </tfoot>
          </table>

          <!-- Extra files summary -->
          <div
            v-if="result.total_extra > 0"
            class="validation-extra-summary"
            data-testid="validation-summary-extra"
          >
            <span class="count-warning">{{ result.total_extra }} extra/unexpected file{{ result.total_extra !== 1 ? 's' : '' }} detected</span>
          </div>
        </div>

        <!-- Per-checkpoint results -->
        <div class="validation-checkpoints" data-testid="validation-dialog-checkpoints">
          <NCollapse :default-expanded-names="expandedCheckpoints">
            <NCollapseItem
              v-for="cp in result.checkpoints"
              :key="cp.checkpoint"
              :name="cp.checkpoint"
              :data-testid="`validation-dialog-cp-${cp.checkpoint}`"
            >
              <template #header>
                <div class="validation-checkpoint-header">
                  <span
                    class="validation-status-icon"
                    :class="{
                      'validation-status-icon--pass': getCheckpointStatus(cp) === 'pass',
                      'validation-status-icon--warning': getCheckpointStatus(cp) === 'warning',
                    }"
                  >
                    {{ getCheckpointStatus(cp) === 'pass' ? '\u2713' : '\u26A0' }}
                  </span>
                  <span class="validation-checkpoint-name" :title="cp.checkpoint">{{ cp.checkpoint }}</span>
                  <span class="validation-checkpoint-counts" :data-testid="`validation-dialog-cp-counts-${cp.checkpoint}`">
                    {{ cp.verified }}/{{ cp.expected }}
                    <span v-if="cp.extra > 0" class="validation-extra-badge" :data-testid="`validation-dialog-cp-extra-${cp.checkpoint}`">(+{{ cp.extra }})</span>
                    <span v-if="cp.invalid_params > 0" class="validation-invalid-badge" :data-testid="`validation-dialog-cp-invalid-${cp.checkpoint}`">{{ cp.invalid_params }} param mismatch</span>
                  </span>
                </div>
              </template>

              <!-- Per-checkpoint file-type breakdown -->
              <table class="validation-breakdown-table validation-breakdown-table--nested" :data-testid="`validation-cp-breakdown-${cp.checkpoint}`">
                <thead>
                  <tr>
                    <th>File Type</th>
                    <th>Expected</th>
                    <th>Valid</th>
                    <th>Missing</th>
                    <th>Invalid</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="ft in getFileTypeBreakdown(cp)"
                    :key="ft.label"
                    :data-testid="`validation-cp-ft-${cp.checkpoint}-${ft.label.toLowerCase().replace(/\s+/g, '-')}`"
                  >
                    <td>{{ ft.label }}</td>
                    <td>{{ ft.expected }}</td>
                    <td>{{ ft.valid }}</td>
                    <td :class="{ 'count-warning': ft.missing > 0 }">{{ ft.missing }}</td>
                    <td :class="{ 'count-error': ft.invalid > 0 }">{{ ft.invalid }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- Per-checkpoint extra files flag -->
              <div
                v-if="cp.extra > 0"
                class="validation-extra-flag"
                :data-testid="`validation-cp-extra-flag-${cp.checkpoint}`"
              >
                <span class="count-warning">{{ cp.extra }} extra/unexpected file{{ cp.extra !== 1 ? 's' : '' }}</span>
              </div>
            </NCollapseItem>
          </NCollapse>
        </div>

        <!-- Regenerate footer hint when there are any issues -->
        <p v-if="hasAnyIssues() && job" class="validation-regenerate-hint">
          Click <strong>Regenerate</strong> to generate missing samples only.
        </p>
      </template>
    </NSpin>
  </NModal>
</template>

<style scoped>
.validation-error {
  color: var(--error-color);
  padding: 0.5rem 0;
  font-size: 0.875rem;
}

.validation-summary {
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}

.validation-summary-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.validation-summary-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.validation-breakdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  margin-bottom: 0.5rem;
}

.validation-breakdown-table th,
.validation-breakdown-table td {
  padding: 0.25rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.validation-breakdown-table th {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.validation-breakdown-table th:not(:first-child),
.validation-breakdown-table td:not(:first-child) {
  text-align: right;
}

.validation-breakdown-table tfoot td {
  border-top: 2px solid var(--border-color);
  border-bottom: none;
}

.validation-breakdown-table--nested {
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
}

.count-warning {
  color: var(--warning-color);
}

.count-error {
  color: var(--error-color);
}

.validation-extra-summary {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.validation-checkpoints {
  font-size: 0.8125rem;
}

.validation-checkpoint-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
}

.validation-status-icon {
  flex-shrink: 0;
  width: 1.25em;
  text-align: center;
}

.validation-status-icon--pass {
  color: var(--success-color, #18a058);
}

.validation-status-icon--warning {
  color: var(--warning-color);
}

.validation-checkpoint-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.validation-checkpoint-counts {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.validation-extra-badge {
  color: var(--warning-color);
  margin-left: 0.25rem;
}

.validation-invalid-badge {
  color: var(--error-color);
  margin-left: 0.25rem;
  font-size: 0.75rem;
}

.validation-extra-flag {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.validation-regenerate-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
</style>

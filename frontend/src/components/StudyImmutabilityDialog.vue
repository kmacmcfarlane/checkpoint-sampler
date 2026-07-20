<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NInput, NButton, NSpace } from 'naive-ui'
import type { AffectedRun } from '../api/types'

/**
 * Immutability dialog shown when the user edits a study that already has
 * generated samples. Offers three mutually exclusive choices: Clone (fork under
 * a new name), Regenerate (update in place and queue regeneration jobs), or
 * Ignore (update and leave samples stale).
 *
 * Extracted from StudyEditor.vue (R-021). Presentation only — the parent still
 * owns the affected-runs fetch and every save/fork API call.
 */
const props = defineProps<{
  /** Whether the dialog is visible. */
  show: boolean
  /** Editable clone name, pre-filled by the parent as "<study name> - copy". */
  cloneName: string
  /** Affected training runs, loaded by the parent when the dialog opens. */
  affectedRuns: AffectedRun[]
  /** True while the affected runs are still loading. */
  loadingAffectedRuns: boolean
}>()

// update:show: Emitted when the modal is dismissed. Payload: the new visibility (boolean).
// update:cloneName: Emitted as the user types a clone name. Payload: the new name (string).
// clone: Emitted when the user confirms the Clone action. No payload.
// regenerate: Emitted when the user picks "Yes, regenerate". No payload.
// ignore: Emitted when the user picks "No, keep existing samples". No payload.
const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:cloneName': [value: string]
  clone: []
  regenerate: []
  ignore: []
}>()

/** Two-way bridge for the modal visibility so v-model:show works on the parent. */
const showModel = computed({
  get: () => props.show,
  set: (value: boolean) => emit('update:show', value),
})

/** Two-way bridge for the clone name input. */
const cloneNameModel = computed({
  get: () => props.cloneName,
  set: (value: string) => emit('update:cloneName', value),
})
</script>

<template>
  <!-- Immutability dialog: shown when user edits a study that has generated samples.
       Three options: Clone, Yes, regenerate (queue jobs with clear_existing), No (ignore). -->
  <NModal
    v-model:show="showModel"
    preset="dialog"
    title="Study Has Generated Samples"
    :closable="true"
    data-testid="immutability-dialog"
  >
    <p>
      This study already has generated samples. Changing its configuration will
      invalidate those samples. What would you like to do?
    </p>

    <!-- Affected runs list -->
    <div v-if="loadingAffectedRuns" style="margin: 0.75rem 0; font-style: italic;" data-testid="immutability-loading-runs">
      Loading affected training runs...
    </div>
    <div v-else-if="affectedRuns.length > 0" style="margin: 0.75rem 0;">
      <strong>Affected training runs (this study only):</strong>
      <ul data-testid="immutability-affected-list" style="margin: 0.5rem 0; padding-left: 1.5rem;">
        <li v-for="run in affectedRuns" :key="run.training_run_name" data-testid="immutability-affected-item">
          <strong>{{ run.training_run_name }}</strong>
          — {{ run.checkpoints_with_samples }}/{{ run.total_checkpoints }} checkpoints with samples
        </li>
      </ul>
    </div>

    <NSpace vertical :size="12" style="margin-top: 1rem;">
      <!-- Clone option -->
      <div class="immutability-option" data-testid="immutability-clone-section">
        <div class="immutability-option-row">
          <NInput
            v-model:value="cloneNameModel"
            placeholder="New study name"
            size="medium"
            style="flex: 1;"
            data-testid="immutability-clone-name-input"
          />
          <NButton
            type="primary"
            :disabled="!cloneName.trim()"
            data-testid="immutability-clone-button"
            @click="emit('clone')"
          >
            Clone
          </NButton>
        </div>
        <div class="immutability-option-hint">
          Create a copy of the study with a new name. Existing samples are untouched.
        </div>
      </div>

      <!-- Yes, regenerate option -->
      <NButton
        type="warning"
        block
        data-testid="immutability-regen-button"
        @click="emit('regenerate')"
      >
        Yes, regenerate
      </NButton>
      <div class="immutability-option-hint" data-testid="immutability-regen-hint">
        Update the study and queue regeneration jobs for the affected training runs listed
        above. Only this study's existing samples will be cleared (when each job starts) —
        other studies and training runs are not affected.
      </div>

      <!-- No option (update without regenerating) -->
      <NButton
        block
        data-testid="immutability-ignore-button"
        @click="emit('ignore')"
      >
        No, keep existing samples
      </NButton>
      <div class="immutability-option-hint">
        Update the study without touching samples. Existing samples will no longer
        match the study's updated parameters.
      </div>
    </NSpace>
  </NModal>
</template>

<style scoped>
/* Immutability dialog option layout */
.immutability-option-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.immutability-option-hint {
  font-size: 0.8125rem;
  color: var(--text-color-secondary, #666);
  margin-top: 0.25rem;
  line-height: 1.4;
}
</style>

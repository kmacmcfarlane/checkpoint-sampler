<script setup lang="ts">
import { ref, watch } from 'vue'
import { NModal, NButton, NCheckbox } from 'naive-ui'

const props = defineProps<{
  /** Controls dialog visibility (v-model:show). */
  show: boolean
  /** Dialog title shown in the modal header. */
  title: string
  /** Descriptive text explaining what will be deleted. */
  description: string
  /** When provided, an optional checkbox is rendered with this label. */
  checkboxLabel?: string
  /** Initial checked state for the optional checkbox. */
  checkboxChecked?: boolean
}>()

// update:show: Emitted when the dialog requests a visibility change. Payload: boolean visibility state.
// confirm: Emitted when the user clicks "Yes, Delete". Payload: boolean checkbox state (false when no checkbox).
// cancel: Emitted when the user clicks Cancel or closes the dialog via mask/close button. No payload.
const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [checkboxChecked: boolean]
  cancel: []
}>()

/** Internal checkbox state, synced from prop on open. */
const internalChecked = ref(props.checkboxChecked ?? false)

// Sync internal checkbox state when the dialog opens or checkboxChecked prop changes
watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      internalChecked.value = props.checkboxChecked ?? false
    }
  },
)

watch(
  () => props.checkboxChecked,
  (val) => {
    internalChecked.value = val ?? false
  },
)

function handleConfirm() {
  emit('confirm', internalChecked.value)
  emit('update:show', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:show', false)
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="title"
    style="max-width: 420px;"
    :mask-closable="true"
    data-testid="confirm-delete-dialog"
    @update:show="(val) => { if (!val) handleCancel() }"
  >
    <div class="dialog-body">
      <p class="description" data-testid="confirm-delete-description">{{ description }}</p>

      <NCheckbox
        v-if="checkboxLabel"
        :checked="internalChecked"
        data-testid="confirm-delete-checkbox"
        class="optional-checkbox"
        @update:checked="internalChecked = $event"
      >
        {{ checkboxLabel }}
      </NCheckbox>
    </div>

    <div class="action-buttons">
      <NButton
        type="error"
        data-testid="confirm-delete-button"
        @click="handleConfirm"
      >
        Yes, Delete
      </NButton>
      <NButton
        data-testid="confirm-cancel-button"
        @click="handleCancel"
      >
        Cancel
      </NButton>
    </div>
  </NModal>
</template>

<style scoped>
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.description {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-color);
  line-height: 1.5;
}

.optional-checkbox {
  margin-top: 0.25rem;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
</style>

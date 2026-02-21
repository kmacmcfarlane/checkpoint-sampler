<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NSelect, NCheckbox } from 'naive-ui'
import type { TrainingRun } from '../api/types'
import { apiClient } from '../api/client'

const trainingRuns = ref<TrainingRun[]>([])
const selectedId = ref<number | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const hasSamplesFilter = ref(true)

const emit = defineEmits<{
  select: [trainingRun: TrainingRun]
}>()

const selectOptions = computed(() =>
  trainingRuns.value.map((run) => ({
    label: run.name,
    value: run.id,
  }))
)

async function fetchTrainingRuns() {
  loading.value = true
  error.value = null
  selectedId.value = null
  try {
    trainingRuns.value = await apiClient.getTrainingRuns(hasSamplesFilter.value)
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to load training runs'
    error.value = message
  } finally {
    loading.value = false
  }
}

onMounted(fetchTrainingRuns)

watch(hasSamplesFilter, fetchTrainingRuns)

function onSelect(value: number | null) {
  if (value === null) {
    selectedId.value = null
    return
  }
  selectedId.value = value
  const run = trainingRuns.value.find((r) => r.id === value)
  if (run) {
    emit('select', run)
  }
}
</script>

<template>
  <div class="training-run-selector">
    <label for="training-run-select">Training Run</label>
    <NSelect
      :value="selectedId"
      :options="selectOptions"
      :disabled="loading || trainingRuns.length === 0"
      :placeholder="loading ? 'Loading...' : 'Select a training run'"
      :loading="loading"
      style="min-width: 200px"
      size="small"
      @update:value="onSelect"
    />
    <NCheckbox
      :checked="hasSamplesFilter"
      data-testid="has-samples-checkbox"
      @update:checked="hasSamplesFilter = $event"
    >
      Has samples
    </NCheckbox>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.training-run-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.training-run-selector label {
  font-weight: 600;
  white-space: nowrap;
}

.training-run-selector .error {
  color: var(--error-color, #d32f2f);
  font-size: 0.875rem;
  margin: 0;
}
</style>

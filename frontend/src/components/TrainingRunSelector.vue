<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { TrainingRun } from '../api/types'
import { apiClient } from '../api/client'

const trainingRuns = ref<TrainingRun[]>([])
const selectedId = ref<number | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const emit = defineEmits<{
  select: [trainingRun: TrainingRun]
}>()

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    trainingRuns.value = await apiClient.getTrainingRuns()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to load training runs'
    error.value = message
  } finally {
    loading.value = false
  }
})

function onSelect(event: Event) {
  const target = event.target as HTMLSelectElement
  const id = Number(target.value)
  if (isNaN(id)) {
    selectedId.value = null
    return
  }
  selectedId.value = id
  const run = trainingRuns.value.find((r) => r.id === id)
  if (run) {
    emit('select', run)
  }
}
</script>

<template>
  <div class="training-run-selector">
    <label for="training-run-select">Training Run</label>
    <select
      id="training-run-select"
      :value="selectedId ?? ''"
      :disabled="loading || trainingRuns.length === 0"
      @change="onSelect"
    >
      <option value="" disabled>
        {{ loading ? 'Loading...' : 'Select a training run' }}
      </option>
      <option
        v-for="run in trainingRuns"
        :key="run.id"
        :value="run.id"
      >
        {{ run.name }}
      </option>
    </select>
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

.training-run-selector select {
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  min-width: 200px;
}

.training-run-selector .error {
  color: #d32f2f;
  font-size: 0.875rem;
  margin: 0;
}
</style>

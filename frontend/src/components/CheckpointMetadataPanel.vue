<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { CheckpointInfo } from '../api/types'
import { apiClient } from '../api/client'

const props = defineProps<{
  checkpoints: CheckpointInfo[]
}>()

const emit = defineEmits<{
  close: []
}>()

const selectedCheckpoint = ref<CheckpointInfo | null>(null)
const metadata = ref<Record<string, string> | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** Checkpoints sorted by step number descending (highest first). */
const sortedCheckpoints = computed(() => {
  return [...props.checkpoints].sort((a, b) => b.step_number - a.step_number)
})

/** Sorted metadata keys for display. */
const metadataKeys = computed(() => {
  if (!metadata.value) return []
  return Object.keys(metadata.value).sort()
})

/** Select the highest step count checkpoint by default when checkpoints change. */
watch(
  () => props.checkpoints,
  (cps) => {
    if (cps.length > 0) {
      const highest = [...cps].sort((a, b) => b.step_number - a.step_number)[0]
      selectCheckpoint(highest)
    } else {
      selectedCheckpoint.value = null
      metadata.value = null
    }
  },
  { immediate: true },
)

async function selectCheckpoint(cp: CheckpointInfo) {
  selectedCheckpoint.value = cp
  metadata.value = null
  error.value = null
  loading.value = true

  try {
    const result = await apiClient.getCheckpointMetadata(cp.filename)
    metadata.value = result.metadata
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load metadata'
    error.value = message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="metadata-panel" role="complementary" aria-label="Checkpoint metadata">
    <div class="panel-header">
      <h2>Checkpoint Metadata</h2>
      <button class="close-btn" aria-label="Close metadata panel" @click="emit('close')">
        &times;
      </button>
    </div>

    <div class="checkpoint-list">
      <h3>Checkpoints</h3>
      <ul role="listbox" aria-label="Checkpoint list">
        <li
          v-for="cp in sortedCheckpoints"
          :key="cp.filename"
          role="option"
          :aria-selected="selectedCheckpoint?.filename === cp.filename"
          :class="{ selected: selectedCheckpoint?.filename === cp.filename }"
          @click="selectCheckpoint(cp)"
        >
          <span class="cp-filename">{{ cp.filename }}</span>
          <span class="cp-step">Step {{ cp.step_number }}</span>
        </li>
      </ul>
    </div>

    <div class="metadata-content">
      <p v-if="loading" class="status">Loading metadata...</p>
      <p v-else-if="error" class="status error" role="alert">{{ error }}</p>
      <template v-else-if="metadata !== null">
        <p v-if="metadataKeys.length === 0" class="status">No metadata available</p>
        <table v-else aria-label="Checkpoint metadata fields">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in metadataKeys" :key="key">
              <td class="field-name">{{ key }}</td>
              <td class="field-value">{{ metadata[key] }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.metadata-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  max-width: 90vw;
  height: 100vh;
  background: #fff;
  border-left: 1px solid #e0e0e0;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  z-index: 500;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.panel-header h2 {
  margin: 0;
  font-size: 1.125rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
  color: #666;
}

.close-btn:hover {
  color: #333;
}

.checkpoint-list {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e0e0e0;
  max-height: 200px;
  overflow-y: auto;
}

.checkpoint-list h3 {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: #666;
}

.checkpoint-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.checkpoint-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0.5rem;
  cursor: pointer;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
}

.checkpoint-list li:hover {
  background: #f5f5f5;
}

.checkpoint-list li.selected {
  background: #e3f2fd;
  font-weight: 500;
}

.cp-filename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 0.5rem;
}

.cp-step {
  color: #888;
  white-space: nowrap;
  font-size: 0.75rem;
}

.metadata-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.status {
  color: #666;
  font-size: 0.875rem;
}

.status.error {
  color: #d32f2f;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

th {
  text-align: left;
  padding: 0.375rem 0.5rem;
  border-bottom: 2px solid #e0e0e0;
  font-size: 0.75rem;
  color: #666;
  text-transform: uppercase;
}

td {
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid #f0f0f0;
  word-break: break-all;
}

.field-name {
  font-family: monospace;
  white-space: nowrap;
  color: #555;
  width: 40%;
}

.field-value {
  width: 60%;
}
</style>

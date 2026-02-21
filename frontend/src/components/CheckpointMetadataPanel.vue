<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NDrawer, NDrawerContent, NButton, NDataTable } from 'naive-ui'
import type { DataTableColumn } from 'naive-ui'
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

/** NDataTable columns for metadata display. */
const tableColumns: DataTableColumn[] = [
  { title: 'Field', key: 'field', width: '40%' },
  { title: 'Value', key: 'value' },
]

/** NDataTable data for metadata display. */
const tableData = computed(() =>
  metadataKeys.value.map((key) => ({
    field: key,
    value: metadata.value?.[key] ?? '',
  }))
)

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
  <NDrawer
    :show="true"
    :width="420"
    placement="right"
    @update:show="(v: boolean) => { if (!v) emit('close') }"
  >
    <NDrawerContent title="Checkpoint Metadata" closable @close="emit('close')">
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
          <NDataTable
            v-else
            :columns="tableColumns"
            :data="tableData"
            :bordered="false"
            size="small"
            :pagination="false"
          />
        </template>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.checkpoint-list {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  max-height: 200px;
  overflow-y: auto;
}

.checkpoint-list h3 {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary, #666);
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
  background: var(--bg-surface, #f5f5f5);
}

.checkpoint-list li.selected {
  background: var(--accent-bg, #e3f2fd);
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
  color: var(--text-secondary, #888);
  white-space: nowrap;
  font-size: 0.75rem;
}

.metadata-content {
  padding-top: 1rem;
}

.status {
  color: var(--text-secondary, #666);
  font-size: 0.875rem;
}

.status.error {
  color: var(--error-color, #d32f2f);
}
</style>

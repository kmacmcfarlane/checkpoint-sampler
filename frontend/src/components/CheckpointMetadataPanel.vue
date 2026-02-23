<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
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

/** Panel width in px. */
const panelWidth = ref(420)
const isNarrow = ref(false)
const dragging = ref(false)

const MIN_WIDTH = 300
const MAX_WIDTH_VW = 0.8

const NARROW_BREAKPOINT = 768

function updateNarrow() {
  isNarrow.value = window.innerWidth < NARROW_BREAKPOINT
}

let mediaQuery: MediaQueryList | null = null

function onMediaChange(e: MediaQueryListEvent) {
  isNarrow.value = !e.matches
}

onMounted(() => {
  updateNarrow()
  mediaQuery = window.matchMedia(`(min-width: ${NARROW_BREAKPOINT}px)`)
  mediaQuery.addEventListener('change', onMediaChange)
})

onUnmounted(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onMediaChange)
  }
  // Clean up drag listeners in case unmounted during drag
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})

/** Effective drawer width: full viewport on narrow screens, otherwise resizable width. */
const effectiveWidth = computed(() => {
  if (isNarrow.value) return window.innerWidth
  return panelWidth.value
})

/** Start drag resize from the left edge handle. */
function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  // Drawer is on the right side: width = viewport width - mouse X position
  const newWidth = window.innerWidth - e.clientX
  const maxWidth = window.innerWidth * MAX_WIDTH_VW
  panelWidth.value = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))
}

function onMouseUp() {
  dragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

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
  <NDrawer
    :show="true"
    :width="effectiveWidth"
    placement="right"
    @update:show="(v: boolean) => { if (!v) emit('close') }"
  >
    <div
      v-if="!isNarrow"
      class="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize metadata panel"
      @mousedown="onResizeStart"
    />
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
          <dl v-else class="metadata-list">
            <div v-for="key in metadataKeys" :key="key" class="metadata-field">
              <dt class="metadata-key">{{ key }}</dt>
              <dd class="metadata-value">{{ metadata[key] }}</dd>
            </div>
          </dl>
        </template>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
  background: transparent;
}

.resize-handle:hover {
  background: var(--accent-color, #1976d2);
  opacity: 0.3;
}

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

.metadata-list {
  margin: 0;
  padding: 0;
}

.metadata-field {
  margin-bottom: 1rem;
}

.metadata-field:last-child {
  margin-bottom: 0;
}

.metadata-key {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.25rem;
}

.metadata-value {
  margin: 0;
  font-size: 0.875rem;
  word-break: break-word;
  color: var(--text-color);
}

.status {
  color: var(--text-secondary, #666);
  font-size: 0.875rem;
}

.status.error {
  color: var(--error-color, #d32f2f);
}
</style>

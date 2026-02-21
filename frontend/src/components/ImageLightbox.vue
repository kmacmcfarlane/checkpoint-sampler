<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { apiClient } from '../api/client'

const props = defineProps<{
  imageUrl: string
}>()

const emit = defineEmits<{
  close: []
}>()

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartTranslateX = ref(0)
const dragStartTranslateY = ref(0)

const metadataLoading = ref(false)
const metadataError = ref<string | null>(null)
const metadata = ref<Record<string, string> | null>(null)
const metadataOpen = ref(false)

const MIN_SCALE = 0.1
const MAX_SCALE = 20
const ZOOM_FACTOR = 1.1

/** Extract the relative image filepath from the full image URL. */
function extractFilepath(imageUrl: string): string | null {
  const prefix = '/api/images/'
  const idx = imageUrl.indexOf(prefix)
  if (idx < 0) return null
  return imageUrl.substring(idx + prefix.length)
}

async function fetchMetadata() {
  const filepath = extractFilepath(props.imageUrl)
  if (!filepath) return

  metadataLoading.value = true
  metadataError.value = null
  metadata.value = null

  try {
    const result = await apiClient.getImageMetadata(filepath)
    metadata.value = result.metadata
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to load metadata'
    metadataError.value = message
  } finally {
    metadataLoading.value = false
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const direction = e.deltaY < 0 ? 1 : -1
  const factor = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))

  // Zoom toward the mouse position
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2
  const offsetX = mouseX - centerX
  const offsetY = mouseY - centerY

  const scaleRatio = newScale / scale.value
  translateX.value = offsetX - scaleRatio * (offsetX - translateX.value)
  translateY.value = offsetY - scaleRatio * (offsetY - translateY.value)

  scale.value = newScale
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragStartTranslateX.value = translateX.value
  dragStartTranslateY.value = translateY.value
  e.preventDefault()
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = dragStartTranslateX.value + (e.clientX - dragStartX.value)
  translateY.value = dragStartTranslateY.value + (e.clientY - dragStartY.value)
}

function onMouseUp() {
  isDragging.value = false
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

function toggleMetadata() {
  metadataOpen.value = !metadataOpen.value
}

function formatJSON(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

// Reset transform and fetch metadata when the image changes
watch(() => props.imageUrl, () => {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  metadata.value = null
  metadataError.value = null
  metadataOpen.value = false
  fetchMetadata()
})

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  fetchMetadata()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    class="lightbox-backdrop"
    role="dialog"
    aria-label="Image lightbox"
    @click="onBackdropClick"
  >
    <div
      class="lightbox-content"
      @wheel="onWheel"
      @mousedown="onMouseDown"
    >
      <img
        :src="imageUrl"
        alt="Full-size image"
        class="lightbox-image"
        :style="{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }"
        draggable="false"
      />
    </div>
    <div class="metadata-panel" @click.stop>
      <button
        class="metadata-toggle"
        aria-label="Toggle metadata"
        @click="toggleMetadata"
      >
        {{ metadataOpen ? 'Hide Metadata' : 'Show Metadata' }}
      </button>
      <div v-if="metadataOpen" class="metadata-content">
        <div v-if="metadataLoading" class="metadata-loading">Loading metadata...</div>
        <div v-else-if="metadataError" class="metadata-error">{{ metadataError }}</div>
        <div v-else-if="metadata && Object.keys(metadata).length === 0" class="metadata-empty">
          No metadata available
        </div>
        <div v-else-if="metadata" class="metadata-entries">
          <div v-for="key in Object.keys(metadata).sort()" :key="key" class="metadata-entry">
            <div class="metadata-key">{{ key }}</div>
            <pre class="metadata-value">{{ formatJSON(metadata[key]) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lightbox-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.lightbox-content {
  overflow: hidden;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 90vh;
  transform-origin: center center;
  user-select: none;
}

.metadata-panel {
  position: fixed;
  bottom: 0;
  right: 0;
  max-width: 50vw;
  max-height: 60vh;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.metadata-toggle {
  padding: 0.375rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 0.25rem 0.25rem 0 0;
  background: rgba(30, 30, 30, 0.9);
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.8125rem;
}

.metadata-toggle:hover {
  background: rgba(50, 50, 50, 0.95);
}

.metadata-content {
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.25rem 0 0 0;
  padding: 0.75rem;
  overflow-y: auto;
  max-height: 50vh;
  width: 50vw;
  color: #e0e0e0;
  font-size: 0.8125rem;
}

.metadata-loading,
.metadata-error,
.metadata-empty {
  color: #999;
  font-style: italic;
}

.metadata-error {
  color: #f44336;
}

.metadata-entry {
  margin-bottom: 0.75rem;
}

.metadata-entry:last-child {
  margin-bottom: 0;
}

.metadata-key {
  font-weight: 600;
  color: #90caf9;
  margin-bottom: 0.25rem;
}

.metadata-value {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem;
  border-radius: 0.25rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  max-height: 30vh;
  overflow-y: auto;
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { NTag } from 'naive-ui'
import { apiClient } from '../api/client'

const enabled = ref(false)
const connected = ref(false)
const pollInterval = ref<number | null>(null)

async function checkStatus() {
  try {
    const status = await apiClient.getComfyUIStatus()
    enabled.value = status.enabled
    connected.value = status.connected
  } catch {
    // On error, assume disconnected
    connected.value = false
  }
}

onMounted(() => {
  checkStatus()
  // Poll every 10 seconds
  pollInterval.value = window.setInterval(checkStatus, 10000)
})

onUnmounted(() => {
  if (pollInterval.value !== null) {
    clearInterval(pollInterval.value)
  }
})
</script>

<template>
  <NTag
    v-if="enabled"
    :type="connected ? 'success' : 'default'"
    size="small"
    :title="connected ? 'ComfyUI connected' : 'ComfyUI disconnected'"
    role="status"
  >
    {{ connected ? 'ComfyUI' : 'ComfyUI (offline)' }}
  </NTag>
</template>

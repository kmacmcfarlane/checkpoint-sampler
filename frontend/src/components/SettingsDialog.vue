<script setup lang="ts">
import { ref, watch } from 'vue'
import { NModal, NButton, NSpin, NAlert, NSwitch } from 'naive-ui'
import { apiClient } from '../api/client'

const props = defineProps<{
  show: boolean
  isDark: boolean
  debugMode: boolean
}>()

// settings-closed: Emitted when the dialog is closed. No payload.
// demo-changed: Emitted when the demo dataset is installed or uninstalled. No payload.
// toggle-theme: Emitted when the user clicks the theme toggle. No payload.
// update:debugMode: Emitted when the debug mode switch is toggled. Payload: new boolean value.
const emit = defineEmits<{
  'update:show': [value: boolean]
  'demo-changed': []
  'toggle-theme': []
  'update:debugMode': [value: boolean]
}>()

const demoInstalled = ref<boolean | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref<string | null>(null)

async function fetchDemoStatus() {
  loading.value = true
  errorMessage.value = null
  try {
    const status = await apiClient.getDemoStatus()
    demoInstalled.value = status.installed
  } catch (err: unknown) {
    const msg = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to check demo status'
    errorMessage.value = msg
  } finally {
    loading.value = false
  }
}

async function installDemo() {
  actionLoading.value = true
  errorMessage.value = null
  try {
    const status = await apiClient.installDemo()
    demoInstalled.value = status.installed
    emit('demo-changed')
  } catch (err: unknown) {
    const msg = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to install demo dataset'
    errorMessage.value = msg
  } finally {
    actionLoading.value = false
  }
}

async function uninstallDemo() {
  actionLoading.value = true
  errorMessage.value = null
  try {
    const status = await apiClient.uninstallDemo()
    demoInstalled.value = status.installed
    emit('demo-changed')
  } catch (err: unknown) {
    const msg = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : 'Failed to remove demo dataset'
    errorMessage.value = msg
  } finally {
    actionLoading.value = false
  }
}

function closeDialog() {
  emit('update:show', false)
}

// Fetch status when dialog opens (immediate so initial show=true triggers fetch)
watch(() => props.show, (newVal) => {
  if (newVal) {
    fetchDemoStatus()
  }
}, { immediate: true })
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Settings"
    style="max-width: 480px"
    :mask-closable="true"
    data-testid="settings-dialog"
    @update:show="closeDialog"
  >
    <div data-testid="appearance-section" class="settings-section">
      <h3 class="section-title">Appearance</h3>
      <div class="setting-row">
        <span class="setting-label">Theme</span>
        <NButton
          size="small"
          quaternary
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          data-testid="theme-toggle"
          @click="emit('toggle-theme')"
        >{{ isDark ? 'Light' : 'Dark' }}</NButton>
      </div>
      <div class="setting-row">
        <span class="setting-label">Debug mode</span>
        <NSwitch
          :value="debugMode"
          size="small"
          data-testid="debug-toggle"
          @update:value="emit('update:debugMode', $event)"
        />
      </div>
    </div>
    <div data-testid="demo-section" class="settings-section">
      <h3 class="section-title">Demo Dataset</h3>
      <template v-if="loading">
        <div class="loading-container">
          <NSpin size="small" />
          <span class="loading-text">Checking demo status...</span>
        </div>
      </template>
      <template v-else-if="errorMessage">
        <NAlert type="error" :title="errorMessage" data-testid="demo-error" />
      </template>
      <template v-else>
        <p class="demo-status" data-testid="demo-status">
          Status: <strong>{{ demoInstalled ? 'Installed' : 'Not installed' }}</strong>
        </p>
        <p class="demo-description">
          The demo dataset provides sample images for exploring the viewer without
          your own training data. It includes 3 checkpoints with images varying
          across prompt, seed, and CFG dimensions.
        </p>
        <div class="demo-actions">
          <NButton
            v-if="demoInstalled"
            type="warning"
            size="small"
            :loading="actionLoading"
            data-testid="demo-delete-button"
            @click="uninstallDemo"
          >
            Delete Demo
          </NButton>
          <NButton
            v-else
            type="primary"
            size="small"
            :loading="actionLoading"
            data-testid="demo-restore-button"
            @click="installDemo"
          >
            Restore Demo
          </NButton>
        </div>
      </template>
    </div>
  </NModal>
</template>

<style scoped>
.settings-section {
  margin-bottom: 1.25rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.settings-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.section-title {
  margin: 0 0 0.75rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-color);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0;
}

.setting-label {
  font-size: 0.875rem;
  color: var(--text-color);
}

.loading-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.loading-text {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.demo-status {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  color: var(--text-color);
}

.demo-description {
  margin: 0 0 0.75rem 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.demo-actions {
  display: flex;
  gap: 0.5rem;
}
</style>

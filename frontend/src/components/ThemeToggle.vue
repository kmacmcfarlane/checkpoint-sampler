<script setup lang="ts">
import { NButton } from 'naive-ui'

defineProps<{
  isDark: boolean
}>()

// toggle: Emitted when the user clicks the theme toggle button to switch between light and dark. No payload.
const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <NButton
    size="small"
    quaternary
    :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
    @click="emit('toggle')"
  >{{ isDark ? 'Light' : 'Dark' }}</NButton>
</template>

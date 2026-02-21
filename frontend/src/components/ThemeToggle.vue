<script setup lang="ts">
import { NButton } from 'naive-ui'

defineProps<{
  isDark: boolean
}>()

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

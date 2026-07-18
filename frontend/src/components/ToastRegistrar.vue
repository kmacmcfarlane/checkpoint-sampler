<script setup lang="ts">
/**
 * Registers the Naive UI message API with the useToast singleton so that
 * App.vue setup logic and deep components can fire toasts. Must be rendered as
 * a descendant of <n-message-provider>. Renders nothing.
 */
import { registerMessageApi } from '../composables/useToast'

registerMessageApi()
</script>

<template>
  <span style="display: none" aria-hidden="true" />
</template>

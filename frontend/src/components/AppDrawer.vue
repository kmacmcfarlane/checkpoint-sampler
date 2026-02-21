<script setup lang="ts">
import { NDrawer, NDrawerContent } from 'naive-ui'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

function onUpdateShow(value: boolean) {
  emit('update:show', value)
}
</script>

<template>
  <NDrawer
    :show="show"
    placement="left"
    :width="360"
    :auto-focus="false"
    @update:show="onUpdateShow"
  >
    <NDrawerContent title="Controls" closable>
      <slot />
    </NDrawerContent>
  </NDrawer>
</template>

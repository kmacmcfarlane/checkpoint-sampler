<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'

defineProps<{
  show: boolean
}>()

// update:show: Emitted when the drawer is opened or closed. Payload: boolean visibility state.
const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const MOBILE_BREAKPOINT = 768

const isMobile = ref(false)
let mediaQuery: MediaQueryList | null = null

function onMediaChange(e: MediaQueryListEvent) {
  isMobile.value = !e.matches
}

onMounted(() => {
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT
  mediaQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`)
  mediaQuery.addEventListener('change', onMediaChange)
})

onUnmounted(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onMediaChange)
  }
})

const drawerWidth = computed(() => {
  if (isMobile.value) return '100%'
  return 360
})

function onUpdateShow(value: boolean) {
  emit('update:show', value)
}
</script>

<template>
  <NDrawer
    :show="show"
    placement="left"
    :width="drawerWidth"
    :auto-focus="false"
    @update:show="onUpdateShow"
  >
    <NDrawerContent title="Controls" closable>
      <slot />
    </NDrawerContent>
  </NDrawer>
</template>

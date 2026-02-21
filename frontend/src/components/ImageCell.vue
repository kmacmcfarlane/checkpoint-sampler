<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  relativePath: string | null
}>()

const emit = defineEmits<{
  click: [imageUrl: string]
}>()

const imageUrl = computed(() => {
  if (!props.relativePath) return null
  return `/api/images/${props.relativePath}`
})

function onClick() {
  if (imageUrl.value) {
    emit('click', imageUrl.value)
  }
}
</script>

<template>
  <div class="image-cell" :class="{ 'image-cell--empty': !relativePath }" @click="onClick">
    <img
      v-if="imageUrl"
      :src="imageUrl"
      :alt="relativePath ?? ''"
      loading="lazy"
    />
    <div v-else class="image-cell__placeholder">
      No image
    </div>
  </div>
</template>

<style scoped>
.image-cell {
  border: 1px solid var(--border-color, #e0e0e0);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 200px;
  min-height: 200px;
}

.image-cell img {
  max-width: 100%;
  height: auto;
  display: block;
  cursor: pointer;
}

.image-cell--empty {
  background-color: var(--bg-surface, #f5f5f5);
}

.image-cell__placeholder {
  color: var(--text-secondary, #999);
  font-size: 0.875rem;
  padding: 1rem;
  text-align: center;
}
</style>

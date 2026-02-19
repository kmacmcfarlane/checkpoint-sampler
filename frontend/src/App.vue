<script setup lang="ts">
import { ref } from 'vue'
import type { TrainingRun } from './api/types'
import TrainingRunSelector from './components/TrainingRunSelector.vue'

const selectedTrainingRun = ref<TrainingRun | null>(null)

function onTrainingRunSelect(run: TrainingRun) {
  selectedTrainingRun.value = run
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Checkpoint Sampler</h1>
      <TrainingRunSelector @select="onTrainingRunSelect" />
    </header>
    <main class="app-main">
      <p v-if="!selectedTrainingRun">Select a training run to get started.</p>
      <p v-else>Training run: {{ selectedTrainingRun.name }}</p>
    </main>
  </div>
</template>

<style scoped>
.app {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 100vw;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.app-main {
  padding: 1rem;
  flex: 1;
}
</style>

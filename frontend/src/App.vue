<script setup lang="ts">
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Checkpoint Sampler</h1>
    </header>
    <main class="app-main">
      <p>Select a training run to get started.</p>
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

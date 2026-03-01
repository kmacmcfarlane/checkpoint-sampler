<script setup lang="ts">
import type { DebugCellInfo } from './types'

defineProps<{
  /** Debug information for this grid cell. */
  info: DebugCellInfo
}>()
</script>

<template>
  <div class="debug-overlay" data-testid="debug-overlay">
    <div class="debug-overlay__content">
      <div v-if="info.xValue !== undefined" class="debug-overlay__row" data-testid="debug-x-value">
        <span class="debug-overlay__label">X:</span>
        <span class="debug-overlay__value">{{ info.xValue }}</span>
      </div>
      <div v-if="info.yValue !== undefined" class="debug-overlay__row" data-testid="debug-y-value">
        <span class="debug-overlay__label">Y:</span>
        <span class="debug-overlay__value">{{ info.yValue }}</span>
      </div>
      <div v-if="info.sliderValue !== undefined" class="debug-overlay__row" data-testid="debug-slider-value">
        <span class="debug-overlay__label">{{ info.sliderDimensionName ?? 'Slider' }}:</span>
        <span class="debug-overlay__value">{{ info.sliderValue }}</span>
      </div>
      <template v-for="(values, dimName) in info.comboSelections" :key="dimName">
        <div class="debug-overlay__row" data-testid="debug-combo-value">
          <span class="debug-overlay__label">{{ dimName }}:</span>
          <span class="debug-overlay__value">{{ values.join(', ') }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.debug-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 4px 6px;
  background-color: rgba(0, 0, 0, 0.75);
  color: rgba(255, 255, 255, 0.95);
  font-size: 0.6875rem;
  line-height: 1.3;
  pointer-events: none;
  z-index: 5;
  overflow: hidden;
}

.debug-overlay__content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.debug-overlay__row {
  display: flex;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.debug-overlay__label {
  font-weight: 700;
  flex-shrink: 0;
}

.debug-overlay__value {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

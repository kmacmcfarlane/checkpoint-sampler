<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NCheckbox } from 'naive-ui'

const props = defineProps<{
  dimensionName: string
  values: string[]
  selected: Set<string>
}>()

// update: Emitted when the selection changes (checkbox toggle, select-all, or select-none). Payload: dimension name and the new selected Set.
const emit = defineEmits<{
  update: [dimensionName: string, selected: Set<string>]
}>()

const allSelected = computed(() => props.selected.size === props.values.length)
const noneSelected = computed(() => props.selected.size === 0)

function toggleValue(value: string, checked: boolean) {
  const next = new Set(props.selected)
  if (checked) {
    next.add(value)
  } else {
    next.delete(value)
  }
  emit('update', props.dimensionName, next)
}

function selectOnly(value: string) {
  emit('update', props.dimensionName, new Set([value]))
}

function selectAll() {
  emit('update', props.dimensionName, new Set(props.values))
}

function selectNone() {
  emit('update', props.dimensionName, new Set())
}
</script>

<template>
  <div class="combo-filter">
    <div class="combo-filter__header">
      <span class="combo-filter__name">{{ dimensionName }}</span>
      <div class="combo-filter__controls">
        <NButton
          size="tiny"
          :disabled="allSelected"
          @click="selectAll"
          :aria-label="`Select all ${dimensionName}`"
        >All</NButton>
        <NButton
          size="tiny"
          :disabled="noneSelected"
          @click="selectNone"
          :aria-label="`Select none ${dimensionName}`"
        >None</NButton>
      </div>
    </div>
    <ul class="combo-filter__list" role="group" :aria-label="`Filter by ${dimensionName}`">
      <li
        v-for="value in values"
        :key="value"
        class="combo-filter__item"
      >
        <label class="combo-filter__checkbox-label">
          <NCheckbox
            :checked="selected.has(value)"
            @update:checked="(checked: boolean) => toggleValue(value, checked)"
            :aria-label="`Toggle ${dimensionName} ${value}`"
          />
          <span
            class="combo-filter__value"
            @click.stop="selectOnly(value)"
            role="button"
            :aria-label="`Select only ${dimensionName} ${value}`"
          >{{ value }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.combo-filter {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.5rem;
  min-width: 150px;
}

.combo-filter__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.combo-filter__name {
  font-weight: 600;
  font-size: 0.875rem;
}

.combo-filter__controls {
  display: flex;
  gap: 0.25rem;
}

.combo-filter__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow-y: auto;
}

.combo-filter__item {
  padding: 0.125rem 0;
}

.combo-filter__checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
}

.combo-filter__value {
  cursor: pointer;
  user-select: none;
}

.combo-filter__value:hover {
  text-decoration: underline;
  color: var(--accent-color);
}
</style>

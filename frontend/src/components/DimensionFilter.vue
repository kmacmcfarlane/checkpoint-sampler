<script setup lang="ts">
import { ref, computed } from 'vue'
import { NButton, NCheckbox, NSelect } from 'naive-ui'
import type { FilterMode } from '../api/types'

const props = defineProps<{
  dimensionName: string
  values: string[]
  selected: Set<string>
  filterMode: FilterMode
}>()

// update: Emitted when the filter selection changes (checkbox toggle, solo, select-all, select-none, or single dropdown). Payload: dimension name and the new selected Set.
const emit = defineEmits<{
  update: [dimensionName: string, selected: Set<string>]
}>()

const expanded = ref(false)

function toggleExpand() {
  expanded.value = !expanded.value
}

// --- Multi mode helpers ---

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

function soloValue(value: string) {
  // If this is the only selected value, unsolo: re-select all
  if (props.selected.size === 1 && props.selected.has(value)) {
    emit('update', props.dimensionName, new Set(props.values))
  } else {
    emit('update', props.dimensionName, new Set([value]))
  }
}

function selectAll() {
  emit('update', props.dimensionName, new Set(props.values))
}

function selectNone() {
  emit('update', props.dimensionName, new Set())
}

// --- Single mode helpers ---

const singleSelectOptions = computed(() =>
  props.values.map((v) => ({ label: v, value: v }))
)

/** The currently selected value for single mode. */
const singleValue = computed(() => {
  // Return first selected value that's in the values list, or first value
  for (const v of props.selected) {
    if (props.values.includes(v)) return v
  }
  return props.values[0] ?? null
})

function onSingleChange(value: string | null) {
  if (value !== null) {
    emit('update', props.dimensionName, new Set([value]))
  }
}
</script>

<template>
  <div v-if="filterMode !== 'hide'" class="dimension-filter">
    <div class="dimension-filter__header" @click="toggleExpand">
      <button
        class="dimension-filter__toggle"
        :aria-expanded="expanded"
        :aria-label="`Toggle ${dimensionName} filter`"
      >
        <span class="dimension-filter__arrow" :class="{ 'dimension-filter__arrow--expanded': expanded }">&#9654;</span>
        <span class="dimension-filter__name">{{ dimensionName }}</span>
      </button>
    </div>
    <div v-if="expanded" class="dimension-filter__content">
      <!-- Single mode -->
      <template v-if="filterMode === 'single'">
        <NSelect
          :value="singleValue"
          :options="singleSelectOptions"
          size="small"
          :aria-label="`Filter ${dimensionName}`"
          @update:value="onSingleChange"
        />
      </template>
      <!-- Multi mode -->
      <template v-else-if="filterMode === 'multi'">
        <div class="dimension-filter__controls">
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
        <ul class="dimension-filter__list" role="group" :aria-label="`Filter by ${dimensionName}`">
          <li
            v-for="value in values"
            :key="value"
            class="dimension-filter__item"
          >
            <label class="dimension-filter__checkbox-label">
              <NCheckbox
                :checked="selected.has(value)"
                @update:checked="(checked: boolean) => toggleValue(value, checked)"
                :aria-label="`Toggle ${dimensionName} ${value}`"
              />
              <span
                class="dimension-filter__value"
                @click.stop="soloValue(value)"
                role="button"
                :aria-label="`Solo ${dimensionName} ${value}`"
              >{{ value }}</span>
            </label>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dimension-filter {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.5rem;
  min-width: 120px;
  max-width: 100%;
  box-sizing: border-box;
}

.dimension-filter__header {
  cursor: pointer;
  user-select: none;
}

.dimension-filter__toggle {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.dimension-filter__arrow {
  display: inline-block;
  font-size: 0.625rem;
  transition: transform 0.15s;
}

.dimension-filter__arrow--expanded {
  transform: rotate(90deg);
}

.dimension-filter__name {
  font-weight: 600;
  font-size: 0.875rem;
}

.dimension-filter__content {
  margin-top: 0.25rem;
}

.dimension-filter__controls {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
}

.dimension-filter__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow-y: auto;
}

.dimension-filter__item {
  padding: 0.125rem 0;
}

.dimension-filter__checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
}

.dimension-filter__value {
  cursor: pointer;
  user-select: none;
}

.dimension-filter__value:hover {
  text-decoration: underline;
  color: var(--accent-color);
}
</style>

import type { Preset } from '../api/types'

/**
 * Compute warnings for dimensions referenced by a preset that are not present
 * in the current dimension set. Returns an array of missing dimension names.
 *
 * Shared between App.vue (eager preset restore) and PresetSelector.vue
 * (user-triggered preset load) to avoid duplicating the warning logic.
 */
export function computePresetWarnings(preset: Preset, currentDimensionNames: string[]): string[] {
  const warnings: string[] = []
  const allPresetDims = new Set<string>()
  if (preset.mapping.x) allPresetDims.add(preset.mapping.x)
  if (preset.mapping.y) allPresetDims.add(preset.mapping.y)
  if (preset.mapping.slider) allPresetDims.add(preset.mapping.slider)
  for (const c of preset.mapping.combos) allPresetDims.add(c)

  const currentDims = new Set(currentDimensionNames)
  for (const dim of allPresetDims) {
    if (!currentDims.has(dim)) {
      warnings.push(dim)
    }
  }
  return warnings
}

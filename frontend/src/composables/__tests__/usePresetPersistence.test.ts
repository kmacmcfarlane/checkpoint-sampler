import { describe, it, expect, beforeEach } from 'vitest'
import { usePresetPersistence } from '../usePresetPersistence'

const STORAGE_KEY = 'checkpoint-sampler-last-preset'

describe('usePresetPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // AC1: FE: Last used preset is stored in localStorage per training run + study combo

  it('returns null when no data is stored for a combo', () => {
    const { getPresetIdForCombo } = usePresetPersistence()
    expect(getPresetIdForCombo(1, '')).toBeNull()
    expect(getPresetIdForCombo(1, 'study-a')).toBeNull()
  })

  it('saves and retrieves preset per training run + study combo', () => {
    // AC1: preset is stored per TR+study key
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(123, 'study-a', 'preset-abc')
    expect(getPresetIdForCombo(123, 'study-a')).toBe('preset-abc')
  })

  it('saves preset to localStorage', () => {
    const { savePresetSelection } = usePresetPersistence()
    savePresetSelection(123, 'study-a', 'preset-abc')

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.presetsByKey['123|study-a']).toBe('preset-abc')
  })

  it('different TR+study combos are stored independently', () => {
    // AC1: each (TR, study) pair has its own entry
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-1a')
    savePresetSelection(1, 'study-b', 'preset-1b')
    savePresetSelection(2, 'study-a', 'preset-2a')

    expect(getPresetIdForCombo(1, 'study-a')).toBe('preset-1a')
    expect(getPresetIdForCombo(1, 'study-b')).toBe('preset-1b')
    expect(getPresetIdForCombo(2, 'study-a')).toBe('preset-2a')
  })

  it('returns null for a combo that has not been saved', () => {
    // AC2: retrieving unknown combo returns null (no preset to restore)
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-abc')
    expect(getPresetIdForCombo(2, 'study-a')).toBeNull()
    expect(getPresetIdForCombo(1, 'study-b')).toBeNull()
  })

  it('overwrites previous preset for the same TR+study combo', () => {
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-old')
    savePresetSelection(1, 'study-a', 'preset-new')

    expect(getPresetIdForCombo(1, 'study-a')).toBe('preset-new')
  })

  it('clears preset for a specific TR+study combo', () => {
    const { savePresetSelection, getPresetIdForCombo, clearPresetForCombo } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-abc')
    savePresetSelection(2, 'study-a', 'preset-xyz')

    clearPresetForCombo(1, 'study-a')

    expect(getPresetIdForCombo(1, 'study-a')).toBeNull()
    // Other combos should be unaffected
    expect(getPresetIdForCombo(2, 'study-a')).toBe('preset-xyz')
  })

  it('clears all preset selections', () => {
    const { savePresetSelection, getPresetIdForCombo, clearAllPresetSelections } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-abc')
    savePresetSelection(2, 'study-b', 'preset-xyz')

    clearAllPresetSelections()

    expect(getPresetIdForCombo(1, 'study-a')).toBeNull()
    expect(getPresetIdForCombo(2, 'study-b')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('supports empty studyOutputDir as a valid combo key', () => {
    // Runs without a study use empty string for studyOutputDir
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(1, '', 'preset-no-study')
    expect(getPresetIdForCombo(1, '')).toBe('preset-no-study')
    // Should not match study variants
    expect(getPresetIdForCombo(1, 'some-study')).toBeNull()
  })

  it('restores data from localStorage on next instantiation', () => {
    // AC2: data persists across page loads (new composable instance reads from localStorage)
    const { savePresetSelection } = usePresetPersistence()
    savePresetSelection(42, 'study-x', 'preset-saved')

    // Simulate new page load — new composable instance reads from localStorage
    const { getPresetIdForCombo } = usePresetPersistence()
    expect(getPresetIdForCombo(42, 'study-x')).toBe('preset-saved')
  })

  it('returns null for unknown combo even when localStorage has data for other combos', () => {
    // AC3 (edge case): stored preset for a different combo must not bleed into an unrelated combo
    const { savePresetSelection, getPresetIdForCombo } = usePresetPersistence()

    savePresetSelection(1, 'study-a', 'preset-abc')
    expect(getPresetIdForCombo(99, 'study-z')).toBeNull()
  })

  describe('backward-compatible migration from legacy single-entry format', () => {
    it('migrates legacy format { trainingRunId, presetId } to per-combo map (studyOutputDir="")', () => {
      // The old format stored a single { trainingRunId, presetId } entry.
      // On read it should be migrated to presetsByKey with key "trainingRunId|"
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ trainingRunId: 10, presetId: 'preset-legacy' }),
      )

      const { getPresetIdForCombo } = usePresetPersistence()
      // Legacy entry is migrated using empty studyOutputDir
      expect(getPresetIdForCombo(10, '')).toBe('preset-legacy')
    })

    it('does not migrate legacy entry to a non-empty studyOutputDir', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ trainingRunId: 10, presetId: 'preset-legacy' }),
      )

      const { getPresetIdForCombo } = usePresetPersistence()
      // Legacy entry should NOT appear under a study-keyed combo
      expect(getPresetIdForCombo(10, 'some-study')).toBeNull()
    })
  })

  describe('edge cases: invalid localStorage data', () => {
    it('returns null when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json')
      const { getPresetIdForCombo } = usePresetPersistence()
      expect(getPresetIdForCombo(1, '')).toBeNull()
    })

    it('returns null when localStorage contains unexpected structure', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ someOtherField: 123 }))
      const { getPresetIdForCombo } = usePresetPersistence()
      expect(getPresetIdForCombo(1, '')).toBeNull()
    })

    it('returns null when localStorage contains a primitive value', () => {
      localStorage.setItem(STORAGE_KEY, 'just-a-string')
      const { getPresetIdForCombo } = usePresetPersistence()
      expect(getPresetIdForCombo(1, '')).toBeNull()
    })

    it('returns null when localStorage contains null', () => {
      localStorage.setItem(STORAGE_KEY, 'null')
      const { getPresetIdForCombo } = usePresetPersistence()
      expect(getPresetIdForCombo(1, '')).toBeNull()
    })
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { usePresetPersistence } from '../usePresetPersistence'

const STORAGE_KEY = 'checkpoint-sampler-last-preset'

describe('usePresetPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no data is stored', () => {
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('saves preset selection to localStorage', () => {
    const { savePresetSelection, savedData } = usePresetPersistence()
    savePresetSelection(123, 'preset-abc')

    expect(savedData.value).toEqual({
      trainingRunId: 123,
      presetId: 'preset-abc',
    })

    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(JSON.stringify({ trainingRunId: 123, presetId: 'preset-abc' }))
  })

  it('restores saved data from localStorage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ trainingRunId: 456, presetId: 'preset-xyz' })
    )

    const { savedData } = usePresetPersistence()
    expect(savedData.value).toEqual({
      trainingRunId: 456,
      presetId: 'preset-xyz',
    })
  })

  it('clears preset selection from localStorage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ trainingRunId: 789, presetId: 'preset-123' })
    )

    const { savedData, clearPresetSelection } = usePresetPersistence()
    expect(savedData.value).not.toBeNull()

    clearPresetSelection()
    expect(savedData.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('overwrites previous selection when saving a new one', () => {
    const { savePresetSelection, savedData } = usePresetPersistence()

    savePresetSelection(100, 'preset-old')
    expect(savedData.value?.presetId).toBe('preset-old')

    savePresetSelection(200, 'preset-new')
    expect(savedData.value).toEqual({
      trainingRunId: 200,
      presetId: 'preset-new',
    })

    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(JSON.stringify({ trainingRunId: 200, presetId: 'preset-new' }))
  })

  it('ignores invalid JSON in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json')
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('ignores data with missing trainingRunId', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: 'preset-only' }))
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('ignores data with missing presetId', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trainingRunId: 999 }))
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('ignores data with wrong types', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ trainingRunId: 'not-a-number', presetId: 123 })
    )
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('handles primitive values in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'just-a-string')
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })

  it('handles null in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'null')
    const { savedData } = usePresetPersistence()
    expect(savedData.value).toBeNull()
  })
})

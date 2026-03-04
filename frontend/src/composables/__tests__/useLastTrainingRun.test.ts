import { describe, it, expect, beforeEach } from 'vitest'
import { useLastTrainingRun } from '../useLastTrainingRun'

const STORAGE_KEY = 'checkpoint-sampler-last-training-run'

describe('useLastTrainingRun', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no data is stored', () => {
    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  it('saves the training run ID to localStorage', () => {
    const { saveLastTrainingRun, lastTrainingRunId } = useLastTrainingRun()
    saveLastTrainingRun(42)

    expect(lastTrainingRunId.value).toBe(42)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('42')
  })

  it('restores saved training run ID from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '123')

    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBe(123)
  })

  it('clears the training run ID from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '456')

    const { lastTrainingRunId, clearLastTrainingRun } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBe(456)

    clearLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('overwrites previous ID when saving a new one', () => {
    const { saveLastTrainingRun, lastTrainingRunId } = useLastTrainingRun()

    saveLastTrainingRun(100)
    expect(lastTrainingRunId.value).toBe(100)

    saveLastTrainingRun(200)
    expect(lastTrainingRunId.value).toBe(200)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('200')
  })

  it('ignores invalid (non-numeric) data in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-number')
    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  it('ignores empty string in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '')
    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })
})

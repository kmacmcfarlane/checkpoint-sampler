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

  it('saves the training run ID to localStorage as structured JSON', () => {
    const { saveLastTrainingRun, lastTrainingRunId } = useLastTrainingRun()
    saveLastTrainingRun('run-42')

    expect(lastTrainingRunId.value).toBe('run-42')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.runId).toBe('run-42')
    expect(stored.studiesByRunDir).toEqual({})
  })

  it('discards a legacy plain-number format (S-155: ids are opaque strings)', () => {
    localStorage.setItem(STORAGE_KEY, '123')

    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  it('discards a legacy numeric runId in structured JSON (S-155)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ runId: 123, studiesByRunDir: {} }))

    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  it('restores saved training run ID from structured JSON format', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ runId: 'run-123', studiesByRunDir: {} }))

    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBe('run-123')
  })

  it('clears the training run ID from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ runId: 'run-456', studiesByRunDir: {} }))

    const { lastTrainingRunId, clearLastTrainingRun } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBe('run-456')

    clearLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('overwrites previous ID when saving a new one', () => {
    const { saveLastTrainingRun, lastTrainingRunId } = useLastTrainingRun()

    saveLastTrainingRun('run-100')
    expect(lastTrainingRunId.value).toBe('run-100')

    saveLastTrainingRun('run-200')
    expect(lastTrainingRunId.value).toBe('run-200')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.runId).toBe('run-200')
  })

  it('ignores invalid (non-JSON) data in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-number')
    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  it('ignores empty string in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '')
    const { lastTrainingRunId } = useLastTrainingRun()
    expect(lastTrainingRunId.value).toBeNull()
  })

  describe('per-training-run study persistence', () => {
    it('saves and retrieves study selection per training run dir', () => {
      const { saveLastStudy, getLastStudy, saveLastTrainingRun } = useLastTrainingRun()
      saveLastTrainingRun('run-1')
      saveLastStudy('my-model', 'my-model/study-a')

      expect(getLastStudy('my-model')).toBe('my-model/study-a')
    })

    it('returns null for unknown training run dir', () => {
      const { getLastStudy, saveLastTrainingRun } = useLastTrainingRun()
      saveLastTrainingRun('run-1')

      expect(getLastStudy('unknown-model')).toBeNull()
    })

    it('overwrites previous study selection for same training run dir', () => {
      const { saveLastStudy, getLastStudy, saveLastTrainingRun } = useLastTrainingRun()
      saveLastTrainingRun('run-1')
      saveLastStudy('my-model', 'my-model/study-a')
      saveLastStudy('my-model', 'my-model/study-b')

      expect(getLastStudy('my-model')).toBe('my-model/study-b')
    })

    it('keeps study selections for different training run dirs independent', () => {
      const { saveLastStudy, getLastStudy, saveLastTrainingRun } = useLastTrainingRun()
      saveLastTrainingRun('run-1')
      saveLastStudy('model-a', 'model-a/study-1')
      saveLastStudy('model-b', 'model-b/study-2')

      expect(getLastStudy('model-a')).toBe('model-a/study-1')
      expect(getLastStudy('model-b')).toBe('model-b/study-2')
    })

    it('preserves study selections when saving a new training run ID', () => {
      const { saveLastTrainingRun, saveLastStudy, getLastStudy } = useLastTrainingRun()
      saveLastTrainingRun('run-1')
      saveLastStudy('my-model', 'my-model/study-a')

      saveLastTrainingRun('run-2')
      expect(getLastStudy('my-model')).toBe('my-model/study-a')
    })
  })
})

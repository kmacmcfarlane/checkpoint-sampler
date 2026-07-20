import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MRU_WORKFLOW_KEY,
  MRU_WORKFLOW_VAE_TE_KEY,
  MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY,
  getMruWorkflow,
  saveMruWorkflow,
  normalizeMruEntry,
  getMruVaeTeForWorkflow,
  saveMruVaeTe,
  getMruSamplerSchedulerForWorkflow,
  saveMruSamplerScheduler,
} from '../studyMru'

describe('studyMru', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('workflow template', () => {
    it('round-trips a saved workflow name', () => {
      saveMruWorkflow('flux.json')
      expect(getMruWorkflow()).toBe('flux.json')
    })

    it('returns null when nothing is stored', () => {
      expect(getMruWorkflow()).toBeNull()
    })

    it('removes the entry when saving null', () => {
      saveMruWorkflow('flux.json')
      saveMruWorkflow(null)
      expect(localStorage.getItem(MRU_WORKFLOW_KEY)).toBeNull()
    })

    it('degrades to null when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
      expect(getMruWorkflow()).toBeNull()
    })
  })

  describe('normalizeMruEntry', () => {
    it('returns null for non-object entries', () => {
      expect(normalizeMruEntry(null)).toBeNull()
      expect(normalizeMruEntry('nope')).toBeNull()
      expect(normalizeMruEntry(42)).toBeNull()
    })

    it('passes through the multi-value shape', () => {
      expect(normalizeMruEntry({ vaes: ['v1'], textEncoders: ['t1'], shifts: [3] })).toEqual({
        vaes: ['v1'],
        textEncoders: ['t1'],
        shifts: [3],
      })
    })

    it('fills missing arrays in a partial multi-value shape', () => {
      expect(normalizeMruEntry({ vaes: ['v1'] })).toEqual({
        vaes: ['v1'],
        textEncoders: [],
        shifts: [],
      })
    })

    it('wraps the legacy single-value shape into arrays (S-157)', () => {
      expect(normalizeMruEntry({ vae: 'v1', textEncoder: 't1', shift: 2.5 })).toEqual({
        vaes: ['v1'],
        textEncoders: ['t1'],
        shifts: [2.5],
      })
    })

    it('drops empty-string legacy values but keeps a legacy shift of 0', () => {
      expect(normalizeMruEntry({ vae: '', textEncoder: '', shift: 0 })).toEqual({
        vaes: [],
        textEncoders: [],
        shifts: [0],
      })
    })
  })

  describe('VAE / text-encoder / shift map', () => {
    it('round-trips per-workflow dimensions', () => {
      saveMruVaeTe('flux.json', ['vae-a'], ['clip-a'], [3])
      expect(getMruVaeTeForWorkflow('flux.json')).toEqual({
        vaes: ['vae-a'],
        textEncoders: ['clip-a'],
        shifts: [3],
      })
    })

    it('keeps entries for different workflows independent', () => {
      saveMruVaeTe('a.json', ['vae-a'], [], [])
      saveMruVaeTe('b.json', ['vae-b'], [], [])

      expect(getMruVaeTeForWorkflow('a.json')?.vaes).toEqual(['vae-a'])
      expect(getMruVaeTeForWorkflow('b.json')?.vaes).toEqual(['vae-b'])
    })

    it('returns null for an unknown workflow', () => {
      expect(getMruVaeTeForWorkflow('missing.json')).toBeNull()
    })

    it('returns null when the stored JSON is corrupt', () => {
      localStorage.setItem(MRU_WORKFLOW_VAE_TE_KEY, '{not json')
      expect(getMruVaeTeForWorkflow('flux.json')).toBeNull()
    })

    it('reads a legacy single-value entry written before S-157', () => {
      localStorage.setItem(
        MRU_WORKFLOW_VAE_TE_KEY,
        JSON.stringify({ 'flux.json': { vae: 'vae-a', textEncoder: 'clip-a', shift: 1.5 } }),
      )
      expect(getMruVaeTeForWorkflow('flux.json')).toEqual({
        vaes: ['vae-a'],
        textEncoders: ['clip-a'],
        shifts: [1.5],
      })
    })
  })

  describe('sampler/scheduler pairs', () => {
    it('round-trips per-workflow pairs', () => {
      const pairs = [{ sampler: 'euler', scheduler: 'normal' }]
      saveMruSamplerScheduler('flux.json', pairs)
      expect(getMruSamplerSchedulerForWorkflow('flux.json')).toEqual(pairs)
    })

    it('returns null for an unknown workflow', () => {
      expect(getMruSamplerSchedulerForWorkflow('missing.json')).toBeNull()
    })

    it('returns null when the stored JSON is corrupt', () => {
      localStorage.setItem(MRU_WORKFLOW_SAMPLER_SCHEDULER_KEY, 'garbage')
      expect(getMruSamplerSchedulerForWorkflow('flux.json')).toBeNull()
    })

    it('does not throw when localStorage rejects writes', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
      expect(() => saveMruSamplerScheduler('flux.json', [])).not.toThrow()
    })
  })
})

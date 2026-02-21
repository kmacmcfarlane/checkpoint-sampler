import { describe, it, expect } from 'vitest'
import { parseImagePath } from '../parseImagePath'
import type { CheckpointInfo } from '../../api/types'

describe('parseImagePath', () => {
  it('parses a standard query-encoded image path', () => {
    const result = parseImagePath('checkpoint.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png')
    expect(result).toEqual({
      relative_path: 'checkpoint.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png',
      dimensions: {
        index: '0',
        prompt_name: 'forest',
        seed: '420',
        cfg: '1',
      },
    })
  })

  it('strips the _NNNNN_ batch suffix', () => {
    const result = parseImagePath('cp.safetensors/seed=42&_00005_.png')
    expect(result).not.toBeNull()
    expect(result!.dimensions).toEqual({ seed: '42' })
  })

  it('handles files without batch suffix', () => {
    const result = parseImagePath('cp.safetensors/seed=42.png')
    expect(result).not.toBeNull()
    expect(result!.dimensions).toEqual({ seed: '42' })
  })

  it('returns null for paths without a directory separator', () => {
    expect(parseImagePath('just-a-file.png')).toBeNull()
  })

  it('returns null for non-PNG files', () => {
    expect(parseImagePath('cp.safetensors/seed=42.jpg')).toBeNull()
  })

  it('is case-insensitive for PNG extension', () => {
    const result = parseImagePath('cp.safetensors/seed=42.PNG')
    expect(result).not.toBeNull()
    expect(result!.dimensions).toEqual({ seed: '42' })
  })

  it('returns null for empty filename after directory', () => {
    expect(parseImagePath('cp.safetensors/')).toBeNull()
  })

  it('returns null for filename with no parseable dimensions', () => {
    expect(parseImagePath('cp.safetensors/_00001_.png')).toBeNull()
  })

  it('returns null for empty path', () => {
    expect(parseImagePath('')).toBeNull()
  })

  describe('with checkpoint lookup', () => {
    const checkpoints: CheckpointInfo[] = [
      { filename: 'model-step00004500.safetensors', step_number: 4500, has_samples: true },
      { filename: 'model-step00005000.safetensors', step_number: 5000, has_samples: true },
      { filename: 'model.safetensors', step_number: 9000, has_samples: true },
    ]

    it('adds checkpoint dimension from matching checkpoint', () => {
      const result = parseImagePath(
        'model-step00004500.safetensors/seed=42&cfg=1&_00001_.png',
        checkpoints,
      )
      expect(result).not.toBeNull()
      expect(result!.dimensions['checkpoint']).toBe('4500')
      expect(result!.dimensions['seed']).toBe('42')
    })

    it('handles checkpoint with no step suffix', () => {
      const result = parseImagePath(
        'model.safetensors/seed=42.png',
        checkpoints,
      )
      expect(result).not.toBeNull()
      expect(result!.dimensions['checkpoint']).toBe('9000')
    })

    it('omits checkpoint dimension when no matching checkpoint found', () => {
      const result = parseImagePath(
        'unknown.safetensors/seed=42.png',
        checkpoints,
      )
      expect(result).not.toBeNull()
      expect(result!.dimensions['checkpoint']).toBeUndefined()
    })

    it('omits checkpoint dimension when no checkpoints provided', () => {
      const result = parseImagePath('model.safetensors/seed=42.png')
      expect(result).not.toBeNull()
      expect(result!.dimensions['checkpoint']).toBeUndefined()
    })
  })
})

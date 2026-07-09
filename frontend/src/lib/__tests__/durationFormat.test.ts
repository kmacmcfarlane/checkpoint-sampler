import { describe, it, expect } from 'vitest'
import { formatElapsedDuration } from '../durationFormat'

// AC: FE: duration is formatted human-readably (mm:ss, extending to h:mm:ss beyond one hour)
describe('formatElapsedDuration', () => {
  it.each([
    [0, '00:00'],
    [5, '00:05'],
    [59, '00:59'],
    [60, '01:00'],
    [90, '01:30'],
    [3599, '59:59'],
  ])('formats %i seconds as %s (mm:ss, under 1h)', (seconds, expected) => {
    expect(formatElapsedDuration(seconds)).toBe(expected)
  })

  it.each([
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [7325, '2:02:05'],
    [36000, '10:00:00'],
  ])('formats %i seconds as %s (h:mm:ss, at or beyond 1h boundary)', (seconds, expected) => {
    expect(formatElapsedDuration(seconds)).toBe(expected)
  })

  it('clamps negative input to zero', () => {
    expect(formatElapsedDuration(-5)).toBe('00:00')
  })

  it('clamps non-finite input to zero', () => {
    expect(formatElapsedDuration(NaN)).toBe('00:00')
  })

  it('floors fractional seconds', () => {
    expect(formatElapsedDuration(65.9)).toBe('01:05')
  })
})

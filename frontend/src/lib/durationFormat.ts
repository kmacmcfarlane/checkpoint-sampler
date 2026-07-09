/**
 * Format an elapsed duration (in seconds) as a human-readable clock string.
 *
 * - Less than one hour: `mm:ss` (e.g. "05:30")
 * - One hour or more: `h:mm:ss` (e.g. "1:15:00")
 *
 * Negative or non-finite input is clamped to zero.
 */
export function formatElapsedDuration(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`
  }
  return `${pad(minutes)}:${pad(secs)}`
}

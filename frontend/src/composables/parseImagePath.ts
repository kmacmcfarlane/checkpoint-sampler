import type { CheckpointInfo, ScanImage } from '../api/types'

/**
 * Batch suffix pattern: _NNNNN_ at the end of a filename (before extension).
 * This is a ComfyUI batch counter and is not treated as a dimension.
 */
const BATCH_PATTERN = /_(\d+)_$/

/**
 * Parse a WebSocket event path into a ScanImage.
 *
 * The path is relative to sample_dir and has the format:
 *   checkpoint_filename/query_encoded_image_filename.png
 *
 * The first path segment is the checkpoint directory name (e.g.,
 * "model-step00004500.safetensors"). When checkpoints are provided,
 * the checkpoint directory is matched to a checkpoint entry and its
 * step_number becomes the "checkpoint" dimension value.
 *
 * The image filename is query-encoded: key=value&key=value&_NNNNN_.png
 * The _NNNNN_ batch suffix is ignored.
 *
 * Returns null if the path cannot be parsed.
 */
export function parseImagePath(
  path: string,
  checkpoints?: CheckpointInfo[],
): ScanImage | null {
  // Path must contain at least checkpoint_dir/filename.png
  const slashIndex = path.indexOf('/')
  if (slashIndex < 0) return null

  const checkpointDir = path.slice(0, slashIndex)
  const filename = path.slice(slashIndex + 1)
  if (!filename || !checkpointDir) return null

  // Must be a .png file (case-insensitive)
  if (!filename.toLowerCase().endsWith('.png')) return null

  // Strip .png extension
  let name = filename.slice(0, -4)

  // Remove batch suffix _NNNNN_
  name = name.replace(BATCH_PATTERN, '')

  // Remove trailing & if present after batch removal
  name = name.replace(/&+$/, '')

  if (!name) return null

  // Parse query-encoded dimensions
  const dimensions: Record<string, string> = {}
  try {
    const params = new URLSearchParams(name)
    for (const [key, value] of params) {
      if (key) {
        dimensions[key] = value
      }
    }
  } catch {
    return null
  }

  if (Object.keys(dimensions).length === 0) return null

  // Look up checkpoint step number if checkpoints are provided
  if (checkpoints) {
    const cp = checkpoints.find((c) => c.filename === checkpointDir)
    if (cp) {
      dimensions['checkpoint'] = String(cp.step_number)
    }
  }

  return {
    relative_path: path,
    dimensions,
  }
}

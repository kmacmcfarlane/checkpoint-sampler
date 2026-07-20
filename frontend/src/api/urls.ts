/**
 * Canonical helpers for building backend image URLs.
 *
 * Image paths come from the filesystem scan and may contain characters that are
 * significant in a URL — `#` truncates the path at the fragment, `?` starts a
 * query string, and a bare `%` is an invalid escape. Interpolating a raw path
 * into a URL therefore produces a broken request (R-022). These helpers are the
 * single place that encoding happens, so producers and consumers stay in sync.
 */

const IMAGE_URL_PREFIX = '/api/v1/images/'

/**
 * Percent-encode a relative filepath for use in a URL path.
 *
 * Each segment is encoded individually so the `/` separators stay meaningful
 * while every other reserved character in the segment is escaped.
 */
export function encodeFilepath(filepath: string): string {
  return filepath.split('/').map(encodeURIComponent).join('/')
}

/** Reverse of {@link encodeFilepath}: decode a URL path back to a raw filepath. */
export function decodeFilepath(encoded: string): string {
  return encoded.split('/').map(decodeURIComponent).join('/')
}

/** Build the full backend URL for an image at the given raw relative path. */
export function imageUrl(relativePath: string): string {
  return `${IMAGE_URL_PREFIX}${encodeFilepath(relativePath)}`
}

/**
 * Extract the raw (decoded) relative filepath from a full image URL, or null if
 * the URL is not an image URL.
 */
export function filepathFromImageUrl(url: string): string | null {
  const idx = url.indexOf(IMAGE_URL_PREFIX)
  if (idx < 0) return null
  return decodeFilepath(url.substring(idx + IMAGE_URL_PREFIX.length))
}

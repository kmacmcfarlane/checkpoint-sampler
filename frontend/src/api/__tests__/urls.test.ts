import { describe, it, expect } from 'vitest'
import { encodeFilepath, decodeFilepath, imageUrl, filepathFromImageUrl } from '../urls'

// AC: client.ts encodes filepath segments in getImageMetadata and image URLs
// (filenames with #, ?, % currently break)

describe('encodeFilepath', () => {
  it.each([
    ['run/ckpt/sample.png', 'run/ckpt/sample.png'],
    // '#' would otherwise truncate the path at the URL fragment
    ['run/a#b.png', 'run/a%23b.png'],
    // '?' would otherwise start a query string
    ['run/a?b.png', 'run/a%3Fb.png'],
    // a bare '%' is an invalid escape sequence
    ['run/100%.png', 'run/100%25.png'],
    ['run/a b.png', 'run/a%20b.png'],
    ['run/a+b.png', 'run/a%2Bb.png'],
    ['run/a&b=c.png', 'run/a%26b%3Dc.png'],
  ])('encodes %s as %s', (raw, encoded) => {
    expect(encodeFilepath(raw)).toBe(encoded)
  })

  it('preserves / as a path separator', () => {
    expect(encodeFilepath('a/b/c.png')).toBe('a/b/c.png')
  })

  it('round-trips through decodeFilepath', () => {
    const raw = 'run #1/ckpt?v=2/100% done+x.png'
    expect(decodeFilepath(encodeFilepath(raw))).toBe(raw)
  })
})

describe('imageUrl', () => {
  it('builds an encoded backend image URL', () => {
    expect(imageUrl('run/a#b.png')).toBe('/api/v1/images/run/a%23b.png')
  })
})

describe('filepathFromImageUrl', () => {
  it('extracts and decodes the raw filepath', () => {
    expect(filepathFromImageUrl('/api/v1/images/run/a%23b.png')).toBe('run/a#b.png')
  })

  it('round-trips with imageUrl for awkward filenames', () => {
    const raw = 'run #1/100% done?.png'
    expect(filepathFromImageUrl(imageUrl(raw))).toBe(raw)
  })

  it('returns null for a non-image URL', () => {
    expect(filepathFromImageUrl('/api/v1/studies/1')).toBeNull()
  })
})

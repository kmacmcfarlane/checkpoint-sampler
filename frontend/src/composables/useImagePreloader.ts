import { watch, type Ref } from 'vue'
import type { ScanImage, ScanDimension } from '../api/types'

/**
 * Composable that preloads images in the background so slider navigation feels instant.
 *
 * Priority order:
 * 1. Horizontal neighbors: thumbnails for the +/-3 nearest X-axis cells in each row
 * 2. All slider positions for visible grid cells (enables instant slider movement)
 * 3. Remaining scan images in the background
 *
 * Uses thumbnail URLs when available to minimize bandwidth; full-resolution
 * images are only preloaded for the remaining/background pass.
 *
 * Uses Image() objects to trigger browser HTTP cache population.
 * Preloading is batched to avoid overwhelming the browser with concurrent requests.
 */
export function useImagePreloader(
  images: Ref<ScanImage[]>,
  xDimension: Ref<ScanDimension | null>,
  yDimension: Ref<ScanDimension | null>,
  sliderDimension: Ref<ScanDimension | null>,
  comboSelections: Ref<Record<string, Set<string>>>,
) {
  /** Set of URLs already preloaded (or in progress). */
  const preloaded = new Set<string>()

  /** Active abort controller for cancelling in-flight preloads on reset. */
  let abortController: AbortController | null = null

  function imageUrl(relativePath: string): string {
    return `/api/images/${relativePath}`
  }

  /** Return the preferred preload URL for an image: thumbnail when available, full-res otherwise. */
  function thumbnailOrFullUrl(img: ScanImage): string {
    if (img.thumbnail_path) return imageUrl(img.thumbnail_path)
    return imageUrl(img.relative_path)
  }

  /** Check whether an image passes the current combo filters. */
  function passesComboFilters(img: ScanImage, combos: Record<string, Set<string>>): boolean {
    for (const [dimName, selected] of Object.entries(combos)) {
      const imgValue = img.dimensions[dimName]
      if (imgValue !== undefined && !selected.has(imgValue)) {
        return false
      }
    }
    return true
  }

  /**
   * Preload a batch of URLs sequentially with a small delay between each
   * to avoid starving the browser's connection pool.
   */
  async function preloadBatch(urls: string[], signal: AbortSignal): Promise<void> {
    for (const url of urls) {
      if (signal.aborted) return
      if (preloaded.has(url)) continue
      preloaded.add(url)

      await new Promise<void>((resolve) => {
        const img = new Image()
        const onAbort = () => {
          // A new cycle superseded this one: stop waiting on the in-flight
          // image and let the loop's signal.aborted check exit promptly.
          img.onload = null
          img.onerror = null
          resolve()
        }
        const done = () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
        img.onload = done
        img.onerror = done
        signal.addEventListener('abort', onAbort, { once: true })
        img.src = url
      })
    }
  }

  /**
   * Build horizontal neighbor URLs: for each visible cell, include images from
   * the +/-3 nearest X-axis positions in the same row.
   */
  function buildHorizontalNeighborUrls(
    filtered: ScanImage[],
    xDim: ScanDimension | null,
    yDim: ScanDimension | null,
  ): string[] {
    if (!xDim) return []

    const NEIGHBOR_RADIUS = 3
    const xValues = xDim.values
    const yValues = yDim?.values ?? [undefined]
    const xName = xDim.name
    const yName = yDim?.name

    // Build a lookup: cellKey -> ScanImage[] for all slider positions
    const cellMap = new Map<string, ScanImage[]>()
    for (const img of filtered) {
      const xVal = img.dimensions[xName]
      const yVal = yName ? img.dimensions[yName] : undefined
      const key = `${xVal ?? ''}|${yVal ?? ''}`
      let arr = cellMap.get(key)
      if (!arr) {
        arr = []
        cellMap.set(key, arr)
      }
      arr.push(img)
    }

    const urls: string[] = []

    for (const yVal of yValues) {
      for (let xi = 0; xi < xValues.length; xi++) {
        // For each cell at (xi, yVal), gather neighbors in range [xi-3, xi+3]
        const lo = Math.max(0, xi - NEIGHBOR_RADIUS)
        const hi = Math.min(xValues.length - 1, xi + NEIGHBOR_RADIUS)
        for (let ni = lo; ni <= hi; ni++) {
          if (ni === xi) continue // skip self (already priority 1)
          const neighborKey = `${xValues[ni]}|${yVal ?? ''}`
          const neighborImgs = cellMap.get(neighborKey)
          if (!neighborImgs) continue
          for (const img of neighborImgs) {
            urls.push(thumbnailOrFullUrl(img))
          }
        }
      }
    }

    return urls
  }

  /** Run the preload cycle. */
  async function runPreload() {
    // Cancel any previous in-flight preload cycle
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()
    const signal = abortController.signal

    const allImages = images.value
    const xDim = xDimension.value
    const yDim = yDimension.value
    const sliderDim = sliderDimension.value
    const combos = comboSelections.value

    // Filter images by combo selections
    const filtered = allImages.filter((img) => passesComboFilters(img, combos))

    // Priority 1: All slider positions for visible grid cells (thumbnails preferred)
    // Visible cells are determined by x/y axis values.
    // For each visible cell, preload the image at every slider position.
    const priority1Urls: string[] = []
    const priority2Urls: string[] = []

    if (sliderDim) {
      const xValues = xDim?.values ?? [undefined]
      const yValues = yDim?.values ?? [undefined]
      const xName = xDim?.name
      const yName = yDim?.name

      // Build set of visible cell keys for quick lookup
      const visibleCellKeys = new Set<string>()
      for (const xVal of xValues) {
        for (const yVal of yValues) {
          visibleCellKeys.add(`${xVal ?? ''}|${yVal ?? ''}`)
        }
      }

      for (const img of filtered) {
        const xVal = xName ? img.dimensions[xName] : undefined
        const yVal = yName ? img.dimensions[yName] : undefined
        const cellKey = `${xVal ?? ''}|${yVal ?? ''}`

        const url = thumbnailOrFullUrl(img)
        if (visibleCellKeys.has(cellKey)) {
          // This image belongs to a visible cell at some slider position
          priority1Urls.push(url)
        } else {
          priority2Urls.push(url)
        }
      }
    } else {
      // No slider dimension: all filtered images go to priority 2 (thumbnails preferred)
      for (const img of filtered) {
        priority2Urls.push(thumbnailOrFullUrl(img))
      }
    }

    // Priority 0 (highest): horizontal neighbors (+/-3 X-axis positions per row)
    const horizontalUrls = buildHorizontalNeighborUrls(filtered, xDim, yDim)
    if (horizontalUrls.length > 0) {
      await preloadBatch(horizontalUrls, signal)
    }

    // Preload priority 1 first, then priority 2
    if (!signal.aborted) {
      await preloadBatch(priority1Urls, signal)
    }
    if (!signal.aborted) {
      await preloadBatch(priority2Urls, signal)
    }

    // Background: remaining images not yet preloaded (full-res fallback)
    if (!signal.aborted) {
      const remainingUrls: string[] = []
      for (const img of allImages) {
        const url = thumbnailOrFullUrl(img)
        if (!preloaded.has(url)) {
          remainingUrls.push(url)
        }
      }
      await preloadBatch(remainingUrls, signal)
    }
  }

  /**
   * Serialize the combo selections into a stable string signature so the watch
   * fires on in-place key/value mutations of the reactive object.
   *
   * In production `comboSelections` is a computed that returns the store's
   * reactive object with a stable identity; combo-filter changes mutate keys
   * INSIDE it rather than reassigning. A shallow watch on the object reference
   * would never fire for those changes, so we watch a serialized signature
   * instead (cheaper and more predictable than `{ deep: true }`).
   */
  function comboSignature(combos: Record<string, Set<string>>): string {
    return Object.keys(combos)
      .sort()
      .map((dim) => `${dim}:${[...combos[dim]].sort().join(',')}`)
      .join('|')
  }

  // Watch for changes that should trigger a new preload cycle.
  // Note: we deliberately do NOT clear the `preloaded` set here. The
  // `preloadBatch` has(url) guard skips URLs already loaded, so a retrigger
  // (e.g. a combo-filter change) only fetches newly-visible URLs instead of
  // re-creating Image() objects for everything. The new cycle reprioritizes
  // which URLs load first via runPreload()'s priority ordering.
  watch(
    [
      images,
      xDimension,
      yDimension,
      sliderDimension,
      () => comboSignature(comboSelections.value),
    ],
    () => {
      runPreload()
    },
    { immediate: true },
  )

  return {
    /** Exposed for testing: the set of preloaded URLs. */
    preloaded,
  }
}

/**
 * Shared component types for the grid and lightbox subsystem.
 * Exported here to avoid importing from .vue files and prevent circular dependencies.
 */

/** Minimal context for a single grid cell image, used for grid navigation. */
export interface GridNavItem {
  imageUrl: string
  cellKey: string | null
  sliderValues: string[]
  currentSliderValue: string
  imagesBySliderValue: Record<string, string>
}

/** Context passed when a cell image is clicked. */
export interface ImageClickContext extends GridNavItem {
  cellKey: string
  /** All visible grid images in order, for lightbox navigation. */
  gridImages: GridNavItem[]
  /** Index of this image in gridImages. */
  gridIndex: number
}

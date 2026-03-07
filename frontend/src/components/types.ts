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
  /**
   * Number of X-axis columns in the grid. Used for Y-axis keyboard navigation
   * (Shift+Up/Down) to compute row offsets in the flat gridImages array.
   * 0 when there is no X dimension (Y-only or flat mode).
   */
  gridColumnCount: number
}

/** Debug info for a single grid cell, showing the filtering parameters that selected its image. */
export interface DebugCellInfo {
  /** X dimension value for this cell (undefined if no X axis). */
  xValue?: string
  /** Y dimension value for this cell (undefined if no Y axis). */
  yValue?: string
  /** Current slider dimension value applied to this cell. */
  sliderValue?: string
  /** Slider dimension name (if assigned). */
  sliderDimensionName?: string
  /** Active combo filter selections relevant to this cell. */
  comboSelections: Record<string, string[]>
}

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import XYGrid from '../XYGrid.vue'
import SliderBar from '../SliderBar.vue'
import ImageCell from '../ImageCell.vue'
import type { ScanDimension, ScanImage } from '../../api/types'
import type { ImageClickContext } from '../types'

const xDimension: ScanDimension = {
  name: 'seed',
  type: 'int',
  values: ['42', '123'],
}

const yDimension: ScanDimension = {
  name: 'step',
  type: 'int',
  values: ['500', '1000'],
}

const sliderDimension: ScanDimension = {
  name: 'cfg',
  type: 'int',
  values: ['3', '7'],
}

const sampleImages: ScanImage[] = [
  { relative_path: 'a/seed=42&step=500&cfg=3.png', dimensions: { seed: '42', step: '500', cfg: '3' }, thumbnail_path: '' },
  { relative_path: 'a/seed=123&step=500&cfg=3.png', dimensions: { seed: '123', step: '500', cfg: '3' }, thumbnail_path: '' },
  { relative_path: 'a/seed=42&step=1000&cfg=3.png', dimensions: { seed: '42', step: '1000', cfg: '3' }, thumbnail_path: '' },
  { relative_path: 'a/seed=123&step=1000&cfg=3.png', dimensions: { seed: '123', step: '1000', cfg: '3' }, thumbnail_path: '' },
  { relative_path: 'a/seed=42&step=500&cfg=7.png', dimensions: { seed: '42', step: '500', cfg: '7' }, thumbnail_path: '' },
]

function mountGrid(overrides: Record<string, unknown> = {}) {
  return mount(XYGrid, {
    props: {
      xDimension,
      yDimension,
      images: sampleImages,
      comboSelections: {},
      sliderDimension: null,
      sliderValues: {},
      defaultSliderValue: '',
      cellSize: 200,
      ...overrides,
    },
  })
}

afterEach(() => {
  // Clean up any lingering document listeners from resize handlers
  vi.restoreAllMocks()
})

describe('XYGrid', () => {
  describe('with X and Y dimensions', () => {
    it('renders a grid with role="grid"', () => {
      const wrapper = mountGrid()
      expect(wrapper.find('[role="grid"]').exists()).toBe(true)
    })

    it('renders column headers for X values', () => {
      const wrapper = mountGrid()
      const headers = wrapper.findAll('[role="columnheader"]')
      // 1 corner + 2 X values
      expect(headers).toHaveLength(3)
      expect(headers[1].text()).toBe('42')
      expect(headers[2].text()).toBe('123')
    })

    it('renders row headers for Y values', () => {
      const wrapper = mountGrid()
      const rowHeaders = wrapper.findAll('[role="rowheader"]')
      expect(rowHeaders).toHaveLength(2)
      expect(rowHeaders[0].text()).toBe('500')
      expect(rowHeaders[1].text()).toBe('1000')
    })

    it('renders correct number of grid cells', () => {
      const wrapper = mountGrid()
      const cells = wrapper.findAll('[role="gridcell"]')
      // 2 X values * 2 Y values = 4 cells
      expect(cells).toHaveLength(4)
    })

    it('renders images in matching cells', () => {
      const wrapper = mountGrid()
      const images = wrapper.findAll('img')
      expect(images.length).toBeGreaterThan(0)
      // All 4 cells have matching images
      expect(images).toHaveLength(4)
    })

    it('shows placeholder for missing image combinations', () => {
      // Remove one image to create a gap
      const imagesWithGap = sampleImages.filter(
        (img) => !(img.dimensions.seed === '123' && img.dimensions.step === '1000')
      )
      const wrapper = mountGrid({ images: imagesWithGap })

      const placeholders = wrapper.findAll('.image-cell__placeholder')
      expect(placeholders).toHaveLength(1)
      expect(placeholders[0].text()).toBe('No image')
    })
  })

  describe('with X dimension only', () => {
    it('renders columns without row headers', () => {
      const wrapper = mountGrid({ yDimension: null })

      expect(wrapper.findAll('[role="rowheader"]')).toHaveLength(0)
      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells).toHaveLength(2)
    })

    it('renders column headers', () => {
      const wrapper = mountGrid({ yDimension: null })
      const headers = wrapper.findAll('[role="columnheader"]')
      expect(headers).toHaveLength(2)
    })
  })

  describe('with Y dimension only', () => {
    it('renders rows without column headers', () => {
      const wrapper = mountGrid({ xDimension: null })

      // No column headers since no X dimension
      expect(wrapper.findAll('.xy-grid__col-header')).toHaveLength(0)
      const rowHeaders = wrapper.findAll('[role="rowheader"]')
      expect(rowHeaders).toHaveLength(2)
    })

    it('renders one cell per Y value', () => {
      const wrapper = mountGrid({ xDimension: null })
      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells).toHaveLength(2)
    })
  })

  describe('with no dimensions assigned', () => {
    it('shows message when no images and no axes', () => {
      const wrapper = mountGrid({
        xDimension: null,
        yDimension: null,
        images: [],
      })

      expect(wrapper.find('.xy-grid-empty').exists()).toBe(true)
      expect(wrapper.text()).toContain('No images to display')
    })

    it('shows flat image list when images exist but no axes', () => {
      const wrapper = mountGrid({ xDimension: null, yDimension: null })

      expect(wrapper.find('.xy-grid-flat').exists()).toBe(true)
      const cells = wrapper.findAll('.xy-grid-flat__cell')
      expect(cells.length).toBeGreaterThan(0)
    })
  })

  describe('combo filter integration', () => {
    it('filters images based on combo selections', () => {
      const wrapper = mountGrid({
        comboSelections: {
          cfg: new Set(['3']), // only show cfg=3
        },
      })

      // Only images with cfg=3 should be displayed
      const imgs = wrapper.findAll('img')
      for (const img of imgs) {
        const src = img.attributes('src') ?? ''
        expect(src).toContain('cfg=3')
      }
    })

    it('shows placeholders when combo filter excludes all images for a cell', () => {
      const wrapper = mountGrid({
        comboSelections: {
          cfg: new Set(['999']), // no images match
        },
      })

      const placeholders = wrapper.findAll('.image-cell__placeholder')
      expect(placeholders).toHaveLength(4) // all cells empty
    })
  })

  describe('slider dimension integration', () => {
    it('shows images for default slider value (first value)', () => {
      const wrapper = mountGrid({
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      // Default slider value is '3' (first value)
      // Should show images with cfg=3
      const imgs = wrapper.findAll('img')
      for (const img of imgs) {
        const src = img.attributes('src') ?? ''
        expect(src).toContain('cfg=3')
      }
    })

    it('shows images for specified slider value', () => {
      const wrapper = mountGrid({
        sliderDimension,
        sliderValues: { '42|500': '7' }, // override for seed=42, step=500
        defaultSliderValue: '3',
      })

      // Cell at seed=42, step=500 should show cfg=7
      const imgs = wrapper.findAll('img')
      const srcs = imgs.map((i) => i.attributes('src'))
      expect(srcs).toContain('/api/images/a/seed=42&step=500&cfg=7.png')
    })

    it('renders SliderBar per cell when slider dimension is assigned', () => {
      const wrapper = mountGrid({
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      const sliders = wrapper.findAllComponents(SliderBar)
      // 2x2 grid = 4 cells, each with a slider
      expect(sliders).toHaveLength(4)
    })

    it('emits update:sliderValue when individual slider changes', async () => {
      const wrapper = mountGrid({
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      const sliders = wrapper.findAllComponents(SliderBar)
      // Change slider in first cell (seed=42, step=500)
      sliders[0].vm.$emit('change', '7')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:sliderValue')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['42|500', '7'])
    })

    it('does not render SliderBar when no slider dimension', () => {
      const wrapper = mountGrid({
        sliderDimension: null,
        sliderValues: {},
      })

      const sliders = wrapper.findAllComponents(SliderBar)
      expect(sliders).toHaveLength(0)
    })
  })

  describe('scrolling', () => {
    it('wraps grid in a container without independent overflow', () => {
      const wrapper = mountGrid()
      const container = wrapper.find('.xy-grid-container')
      expect(container.exists()).toBe(true)
      // The container should not have overflow:auto or max-height
      const style = getComputedStyle(container.element)
      expect(style.overflow).not.toBe('auto')
      expect(style.maxHeight).toBe('')
    })
  })

  describe('header click filtering', () => {
    it('emits header:click when an X column header is clicked', async () => {
      const wrapper = mountGrid()
      const headers = wrapper.findAll('.xy-grid__col-header')
      expect(headers.length).toBe(2) // 42, 123

      await headers[0].trigger('click')

      const emitted = wrapper.emitted('header:click')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['seed', '42'])
    })

    it('emits header:click when a Y row header is clicked', async () => {
      const wrapper = mountGrid()
      const headers = wrapper.findAll('.xy-grid__row-header')
      expect(headers.length).toBe(2) // 500, 1000

      await headers[1].trigger('click')

      const emitted = wrapper.emitted('header:click')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['step', '1000'])
    })

    it('emits header:click with correct dimension name for X-only grid', async () => {
      const wrapper = mountGrid({ yDimension: null })
      const headers = wrapper.findAll('.xy-grid__col-header')
      expect(headers.length).toBe(2)

      await headers[1].trigger('click')

      const emitted = wrapper.emitted('header:click')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual(['seed', '123'])
    })

    it('column headers have cursor:pointer style', () => {
      const wrapper = mountGrid()
      const headers = wrapper.findAll('.xy-grid__col-header')
      expect(headers.length).toBeGreaterThan(0)
      expect(headers[0].classes()).toContain('xy-grid__col-header')
    })

    it('row headers have cursor:pointer style', () => {
      const wrapper = mountGrid()
      const headers = wrapper.findAll('.xy-grid__row-header')
      expect(headers.length).toBeGreaterThan(0)
      expect(headers[0].classes()).toContain('xy-grid__row-header')
    })
  })

  describe('cell size control via zoom', () => {
    it('uses cellSize prop for grid template columns', () => {
      const wrapper = mountGrid({ cellSize: 300 })
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 300px 300px')
    })

    it('uses cellSize prop for grid template rows', () => {
      const wrapper = mountGrid({ cellSize: 300 })
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-rows: auto 300px 300px')
    })

    it('updates grid when cellSize changes', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      let grid = wrapper.find('[role="grid"]')
      let style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 200px 200px')

      await wrapper.setProps({ cellSize: 400 })
      grid = wrapper.find('[role="grid"]')
      style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 400px 400px')
    })

    it('grid has gap for spacing between cells', () => {
      const wrapper = mountGrid()
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('gap: 4px')
    })
  })

  describe('header solo filtering grid visibility', () => {
    it('hides non-selected X columns when X dimension is filtered', () => {
      const wrapper = mountGrid({
        comboSelections: {
          seed: new Set(['42']), // solo seed=42
        },
      })

      // Should only render one column header (seed=42)
      const colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(1)
      expect(colHeaders[0].text()).toBe('42')

      // Should only render cells for seed=42 (2 rows * 1 col = 2 cells)
      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells).toHaveLength(2)
    })

    it('hides non-selected Y rows when Y dimension is filtered', () => {
      const wrapper = mountGrid({
        comboSelections: {
          step: new Set(['500']), // solo step=500
        },
      })

      // Should only render one row header (step=500)
      const rowHeaders = wrapper.findAll('[role="rowheader"]')
      expect(rowHeaders).toHaveLength(1)
      expect(rowHeaders[0].text()).toBe('500')

      // Should only render cells for step=500 (1 row * 2 cols = 2 cells)
      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells).toHaveLength(2)
    })

    it('hides both non-selected X columns and Y rows when both are filtered', () => {
      const wrapper = mountGrid({
        comboSelections: {
          seed: new Set(['123']), // solo seed=123
          step: new Set(['1000']), // solo step=1000
        },
      })

      // Should only render one column header (seed=123)
      const colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(1)
      expect(colHeaders[0].text()).toBe('123')

      // Should only render one row header (step=1000)
      const rowHeaders = wrapper.findAll('[role="rowheader"]')
      expect(rowHeaders).toHaveLength(1)
      expect(rowHeaders[0].text()).toBe('1000')

      // Should only render one cell (1 row * 1 col = 1 cell)
      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells).toHaveLength(1)
    })

    it('shows all X columns when all X values are selected', () => {
      const wrapper = mountGrid({
        comboSelections: {
          seed: new Set(['42', '123']), // all values selected
        },
      })

      // Should render all column headers
      const colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(2)
      expect(colHeaders[0].text()).toBe('42')
      expect(colHeaders[1].text()).toBe('123')
    })

    it('shows all Y rows when all Y values are selected', () => {
      const wrapper = mountGrid({
        comboSelections: {
          step: new Set(['500', '1000']), // all values selected
        },
      })

      // Should render all row headers
      const rowHeaders = wrapper.findAll('[role="rowheader"]')
      expect(rowHeaders).toHaveLength(2)
      expect(rowHeaders[0].text()).toBe('500')
      expect(rowHeaders[1].text()).toBe('1000')
    })

    it('shows all values when comboSelections is empty for a dimension', () => {
      const wrapper = mountGrid({
        comboSelections: {
          // seed dimension has no entry, so show all
        },
      })

      // Should render all column headers
      const colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(2)
    })

    it('shows all values when comboSelections Set has zero size', () => {
      const wrapper = mountGrid({
        comboSelections: {
          seed: new Set(), // empty set, show all
        },
      })

      // Should render all column headers
      const colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(2)
    })

    it('updates grid when comboSelections change', async () => {
      const wrapper = mountGrid({
        comboSelections: {
          seed: new Set(['42']), // solo seed=42
        },
      })

      // Initially, only one column
      let colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(1)

      // Change to show all values
      await wrapper.setProps({
        comboSelections: {
          seed: new Set(['42', '123']),
        },
      })

      // Now should show both columns
      colHeaders = wrapper.findAll('.xy-grid__col-header')
      expect(colHeaders).toHaveLength(2)
    })
  })

  describe('CSS Grid alignment', () => {
    it('renders 1x1 grid correctly', () => {
      const singleX: ScanDimension = { name: 'seed', type: 'int', values: ['42'] }
      const singleY: ScanDimension = { name: 'step', type: 'int', values: ['500'] }
      const images: ScanImage[] = [
        { relative_path: 'a/seed=42&step=500.png', dimensions: { seed: '42', step: '500' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ xDimension: singleX, yDimension: singleY, images })

      expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(1)
      expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(2) // corner + 1 header
      expect(wrapper.findAll('[role="rowheader"]')).toHaveLength(1)

      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 200px')
      expect(style).toContain('grid-template-rows: auto 200px')
    })

    it('renders 1xN grid (single column, multiple rows)', () => {
      const singleX: ScanDimension = { name: 'seed', type: 'int', values: ['42'] }
      const threeY: ScanDimension = { name: 'step', type: 'int', values: ['100', '200', '300'] }
      const images: ScanImage[] = [
        { relative_path: 'a/seed=42&step=100.png', dimensions: { seed: '42', step: '100' }, thumbnail_path: '' },
        { relative_path: 'a/seed=42&step=200.png', dimensions: { seed: '42', step: '200' }, thumbnail_path: '' },
        { relative_path: 'a/seed=42&step=300.png', dimensions: { seed: '42', step: '300' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ xDimension: singleX, yDimension: threeY, images })

      expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(3)
      expect(wrapper.findAll('[role="rowheader"]')).toHaveLength(3)

      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 200px')
      expect(style).toContain('grid-template-rows: auto 200px 200px 200px')
    })

    it('renders Nx1 grid (multiple columns, single row)', () => {
      const threeX: ScanDimension = { name: 'seed', type: 'int', values: ['42', '123', '456'] }
      const singleY: ScanDimension = { name: 'step', type: 'int', values: ['500'] }
      const images: ScanImage[] = [
        { relative_path: 'a/seed=42&step=500.png', dimensions: { seed: '42', step: '500' }, thumbnail_path: '' },
        { relative_path: 'a/seed=123&step=500.png', dimensions: { seed: '123', step: '500' }, thumbnail_path: '' },
        { relative_path: 'a/seed=456&step=500.png', dimensions: { seed: '456', step: '500' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ xDimension: threeX, yDimension: singleY, images })

      expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(3)
      expect(wrapper.findAll('.xy-grid__col-header')).toHaveLength(3)

      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 200px 200px 200px')
      expect(style).toContain('grid-template-rows: auto 200px')
    })

    it('renders NxM grid with correct structure', () => {
      const wrapper = mountGrid() // 2x2
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''

      // 2 X values + Y header: auto 200px 200px
      expect(style).toContain('grid-template-columns: auto 200px 200px')
      // 2 Y values + X header: auto 200px 200px
      expect(style).toContain('grid-template-rows: auto 200px 200px')
    })

    it('empty placeholder cells have same grid placement as filled cells', () => {
      // Create images with one combination missing
      const imagesWithGap = sampleImages.filter(
        (img) => !(img.dimensions.seed === '123' && img.dimensions.step === '1000')
      )
      const wrapper = mountGrid({ images: imagesWithGap })

      const cells = wrapper.findAll('[role="gridcell"]')
      // All 4 cells should exist regardless of image presence
      expect(cells).toHaveLength(4)

      // Each cell should have grid-row and grid-column styles
      for (const cell of cells) {
        const style = cell.attributes('style') ?? ''
        expect(style).toContain('grid-row:')
        expect(style).toContain('grid-column:')
      }
    })

    it('X-only grid uses CSS Grid without row header column', () => {
      const wrapper = mountGrid({ yDimension: null })
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''

      // No 'auto' prefix (no row header column)
      expect(style).toContain('grid-template-columns: 200px 200px')
      // Header row + one data row
      expect(style).toContain('grid-template-rows: auto 200px')
    })

    it('Y-only grid uses CSS Grid without column header row', () => {
      const wrapper = mountGrid({ xDimension: null })
      const grid = wrapper.find('[role="grid"]')
      const style = grid.attributes('style') ?? ''

      // Row header + single data column
      expect(style).toContain('grid-template-columns: auto 200px')
      // No 'auto' prefix (no column header row)
      expect(style).toContain('grid-template-rows: 200px 200px')
    })

    it('flat mode uses CSS Grid with consistent cell sizing', () => {
      const wrapper = mountGrid({ xDimension: null, yDimension: null })
      const flatGrid = wrapper.find('.xy-grid-flat__grid')
      const style = flatGrid.attributes('style') ?? ''

      expect(style).toContain('display: grid')
      expect(style).toContain('grid-template-columns: repeat(auto-fill, 200px)')
      expect(style).toContain('grid-auto-rows: 200px')
    })
  })

  describe('debug mode', () => {
    // AC2: Debug overlay shows filtering parameters when debug mode is active
    it('renders debug overlays on cells when debugMode is true', () => {
      const wrapper = mountGrid({ debugMode: true })

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      // 2x2 grid = 4 cells, each should have a debug overlay
      expect(overlays).toHaveLength(4)
    })

    it('does not render debug overlays when debugMode is false', () => {
      const wrapper = mountGrid({ debugMode: false })

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      expect(overlays).toHaveLength(0)
    })

    it('does not render debug overlays when debugMode is not specified (defaults false)', () => {
      const wrapper = mountGrid()

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      expect(overlays).toHaveLength(0)
    })

    it('shows x and y values in debug overlay', () => {
      const wrapper = mountGrid({ debugMode: true })

      // First cell should show x=42, y=500
      const firstOverlay = wrapper.findAll('[data-testid="debug-overlay"]')[0]
      expect(firstOverlay.text()).toContain('42')
      expect(firstOverlay.text()).toContain('500')
    })

    it('shows slider value in debug overlay when slider dimension is assigned', () => {
      const wrapper = mountGrid({
        debugMode: true,
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      const firstOverlay = wrapper.findAll('[data-testid="debug-overlay"]')[0]
      expect(firstOverlay.text()).toContain('cfg:')
      expect(firstOverlay.text()).toContain('3')
    })

    it('shows combo selections in debug overlay (excluding x, y, and slider dimensions)', () => {
      const wrapper = mountGrid({
        debugMode: true,
        comboSelections: {
          cfg: new Set(['3', '7']),
        },
      })

      // cfg is not x, y, or slider, so it should appear in combo selections
      const firstOverlay = wrapper.findAll('[data-testid="debug-overlay"]')[0]
      expect(firstOverlay.text()).toContain('cfg:')
    })

    it('excludes x and y dimension names from combo selections in debug overlay', () => {
      const wrapper = mountGrid({
        debugMode: true,
        comboSelections: {
          seed: new Set(['42', '123']),   // seed is X dimension, should be excluded from combos
          step: new Set(['500', '1000']), // step is Y dimension, should be excluded from combos
          cfg: new Set(['3']),            // cfg is not assigned, should appear
        },
      })

      const firstOverlay = wrapper.findAll('[data-testid="debug-overlay"]')[0]
      const comboRows = firstOverlay.findAll('[data-testid="debug-combo-value"]')
      // Only cfg should appear (seed and step are X/Y axes)
      expect(comboRows).toHaveLength(1)
      expect(comboRows[0].text()).toContain('cfg:')
    })

    it('renders debug overlays in X-only grid', () => {
      const wrapper = mountGrid({ yDimension: null, debugMode: true })

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      // X-only: 2 cells
      expect(overlays).toHaveLength(2)
      // Should show X value but no Y value
      const firstOverlay = overlays[0]
      expect(firstOverlay.find('[data-testid="debug-x-value"]').exists()).toBe(true)
      expect(firstOverlay.find('[data-testid="debug-y-value"]').exists()).toBe(false)
    })

    it('renders debug overlays in Y-only grid', () => {
      const wrapper = mountGrid({ xDimension: null, debugMode: true })

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      // Y-only: 2 cells
      expect(overlays).toHaveLength(2)
      // Should show Y value but no X value
      const firstOverlay = overlays[0]
      expect(firstOverlay.find('[data-testid="debug-x-value"]').exists()).toBe(false)
      expect(firstOverlay.find('[data-testid="debug-y-value"]').exists()).toBe(true)
    })

    it('renders debug overlays in flat mode', () => {
      const wrapper = mountGrid({ xDimension: null, yDimension: null, debugMode: true })

      const overlays = wrapper.findAll('[data-testid="debug-overlay"]')
      // Flat mode should have overlays on all visible cells
      expect(overlays.length).toBeGreaterThan(0)
      // No X or Y values in flat mode
      const firstOverlay = overlays[0]
      expect(firstOverlay.find('[data-testid="debug-x-value"]').exists()).toBe(false)
      expect(firstOverlay.find('[data-testid="debug-y-value"]').exists()).toBe(false)
    })
  })

  describe('corner-based cell resizing', () => {
    it('renders resize handle when grid has axes', () => {
      const wrapper = mountGrid()
      const handle = wrapper.find('.xy-grid__resize-handle')
      expect(handle.exists()).toBe(true)
      expect(handle.attributes('role')).toBe('button')
      expect(handle.attributes('aria-label')).toBe('Resize grid cells')
    })

    it('emits update:cellSize when resize handle is dragged', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      const handle = wrapper.find('.xy-grid__resize-handle')

      // Simulate mousedown
      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      // Simulate mousemove
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 150,
        clientY: 150,
        bubbles: true,
      })
      document.dispatchEvent(mouseMoveEvent)
      await wrapper.vm.$nextTick()

      // Check that update:cellSize was emitted
      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeDefined()
      expect(emitted!.length).toBeGreaterThan(0)
      // Delta is (50 + 50) / 2 = 50, so new size should be 250
      expect(emitted![0]).toEqual([250])

      // Simulate mouseup to clean up
      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
    })

    it('applies dragging class during resize', async () => {
      const wrapper = mountGrid()
      const handle = wrapper.find('.xy-grid__resize-handle')

      expect(handle.classes()).not.toContain('xy-grid__resize-handle--dragging')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })
      await wrapper.vm.$nextTick()

      expect(handle.classes()).toContain('xy-grid__resize-handle--dragging')

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
      await wrapper.vm.$nextTick()

      expect(handle.classes()).not.toContain('xy-grid__resize-handle--dragging')
    })

    it('constrains cell size to min/max bounds', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      const handle = wrapper.find('.xy-grid__resize-handle')

      // Try to drag way beyond max (600px)
      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })
      const largeMoveEvent = new MouseEvent('mousemove', {
        clientX: 1000,
        clientY: 1000,
        bubbles: true,
      })
      document.dispatchEvent(largeMoveEvent)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeDefined()
      // Size should be capped at 600
      const maxEmitted = emitted!.find((e) => e[0] === 600)
      expect(maxEmitted).toBeDefined()

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
    })

    it('maintains aspect ratio by default', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      const handle = wrapper.find('.xy-grid__resize-handle')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      // Drag with different X and Y deltas
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 160, // delta X = 60
        clientY: 140, // delta Y = 40
        bubbles: true,
      })
      document.dispatchEvent(mouseMoveEvent)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeDefined()
      // Average delta: (60 + 40) / 2 = 50
      // New size: 200 + 50 = 250
      expect(emitted![0]).toEqual([250])

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
    })

    it('allows freeform resize when maintainAspectRatio is false', async () => {
      const wrapper = mountGrid({ cellSize: 200, maintainAspectRatio: false })
      const handle = wrapper.find('.xy-grid__resize-handle')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      // Drag with different X and Y deltas
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 160, // delta X = 60
        clientY: 140, // delta Y = 40
        bubbles: true,
      })
      document.dispatchEvent(mouseMoveEvent)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeDefined()
      // Max delta: max(60, 40) = 60
      // New size: 200 + 60 = 260
      expect(emitted![0]).toEqual([260])

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
    })

    it('cleans up event listeners on mouseup', async () => {
      const wrapper = mountGrid()
      const handle = wrapper.find('.xy-grid__resize-handle')

      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
      await wrapper.vm.$nextTick()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })

    it('cleans up event listeners on component unmount', async () => {
      const wrapper = mountGrid()
      const handle = wrapper.find('.xy-grid__resize-handle')

      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      wrapper.unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })

    it('does not emit update:cellSize if size has not changed', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      const handle = wrapper.find('.xy-grid__resize-handle')

      await handle.trigger('mousedown', { clientX: 100, clientY: 100 })

      // Drag with zero delta
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      })
      document.dispatchEvent(mouseMoveEvent)
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('update:cellSize')
      expect(emitted).toBeUndefined()

      const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true })
      document.dispatchEvent(mouseUpEvent)
    })

    it('updates all cells uniformly when cellSize changes', async () => {
      const wrapper = mountGrid({ cellSize: 200 })
      let grid = wrapper.find('[role="grid"]')
      let style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 200px 200px')
      expect(style).toContain('grid-template-rows: auto 200px 200px')

      await wrapper.setProps({ cellSize: 300 })
      grid = wrapper.find('[role="grid"]')
      style = grid.attributes('style') ?? ''
      expect(style).toContain('grid-template-columns: auto 300px 300px')
      expect(style).toContain('grid-template-rows: auto 300px 300px')
    })

    it('resize handle has correct cursor style', () => {
      const wrapper = mountGrid()
      const handle = wrapper.find('.xy-grid__resize-handle')
      expect(handle.classes()).toContain('xy-grid__resize-handle')
    })

    it('does not render resize handle in flat mode', () => {
      const wrapper = mountGrid({ xDimension: null, yDimension: null })
      const handle = wrapper.find('.xy-grid__resize-handle')
      expect(handle.exists()).toBe(false)
    })
  })

  describe('debugInfo propagation in buildGridNavItems gridImages', () => {
    // AC2: debugInfo must be included in each GridNavItem produced by buildGridNavItems
    // so that onLightboxNavigate in App.vue can update lightboxContext.debugInfo when
    // the user presses Shift+Arrow to navigate grid cells inside the lightbox.

    it('includes debugInfo in X+Y grid GridNavItems when debug mode is on', async () => {
      const wrapper = mountGrid({ debugMode: true })

      // Trigger a click on the first ImageCell to retrieve the gridImages payload
      const imageCells = wrapper.findAllComponents(ImageCell)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      // Every GridNavItem in gridImages should have a defined debugInfo
      expect(payload.gridImages.length).toBeGreaterThan(0)
      for (const item of payload.gridImages) {
        expect(item.debugInfo).toBeDefined()
      }

      // The first item (seed=42, step=500) should have xValue='42', yValue='500'
      const firstItem = payload.gridImages[0]
      expect(firstItem.debugInfo!.xValue).toBe('42')
      expect(firstItem.debugInfo!.yValue).toBe('500')
    })

    it('debugInfo is undefined in GridNavItems when debug mode is off', async () => {
      const wrapper = mountGrid({ debugMode: false })

      const imageCells = wrapper.findAllComponents(ImageCell)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      for (const item of payload.gridImages) {
        expect(item.debugInfo).toBeUndefined()
      }
    })

    it('includes debugInfo in X-only GridNavItems when debug mode is on', async () => {
      const xOnlyImages: ScanImage[] = [
        { relative_path: 'a/seed=42&cfg=3.png', dimensions: { seed: '42', cfg: '3' }, thumbnail_path: '' },
        { relative_path: 'a/seed=123&cfg=3.png', dimensions: { seed: '123', cfg: '3' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ yDimension: null, images: xOnlyImages, debugMode: true })

      const imageCells = wrapper.findAllComponents(ImageCell)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      expect(payload.gridImages.length).toBe(2)
      // X-only: each item has xValue but no yValue
      for (const item of payload.gridImages) {
        expect(item.debugInfo).toBeDefined()
        expect(item.debugInfo!.xValue).toBeDefined()
        expect(item.debugInfo!.yValue).toBeUndefined()
      }
    })

    it('includes debugInfo in Y-only GridNavItems when debug mode is on', async () => {
      const yOnlyImages: ScanImage[] = [
        { relative_path: 'a/step=500&cfg=3.png', dimensions: { step: '500', cfg: '3' }, thumbnail_path: '' },
        { relative_path: 'a/step=1000&cfg=3.png', dimensions: { step: '1000', cfg: '3' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ xDimension: null, images: yOnlyImages, debugMode: true })

      const imageCells = wrapper.findAllComponents(ImageCell)
      imageCells[0].vm.$emit('click', '/api/images/a/step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      expect(payload.gridImages.length).toBe(2)
      // Y-only: each item has yValue but no xValue
      for (const item of payload.gridImages) {
        expect(item.debugInfo).toBeDefined()
        expect(item.debugInfo!.yValue).toBeDefined()
        expect(item.debugInfo!.xValue).toBeUndefined()
      }
    })

    it('includes debugInfo in flat-mode GridNavItems when debug mode is on', async () => {
      const flatImages: ScanImage[] = [
        { relative_path: 'a/img1.png', dimensions: { cfg: '3' }, thumbnail_path: '' },
      ]
      const wrapper = mountGrid({ xDimension: null, yDimension: null, images: flatImages, debugMode: true })

      const imageCells = wrapper.findAllComponents(ImageCell)
      expect(imageCells.length).toBeGreaterThan(0)
      imageCells[0].vm.$emit('click', '/api/images/a/img1.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      expect(payload.gridImages.length).toBeGreaterThan(0)
      const item = payload.gridImages[0]
      // Flat mode: no xValue or yValue
      expect(item.debugInfo).toBeDefined()
      expect(item.debugInfo!.xValue).toBeUndefined()
      expect(item.debugInfo!.yValue).toBeUndefined()
    })
  })

  describe('lightbox uses full-resolution PNG URLs (B-100 regression)', () => {
    // AC: Lightbox imagesBySliderValue must use full-resolution PNG paths even when
    // thumbnail_path is set, so the lightbox slider does not display JPEG thumbnails.

    it('imagesBySliderValue uses relative_path (PNG) not thumbnail_path (JPEG) when thumbnails exist', async () => {
      const imagesWithThumbnails: ScanImage[] = [
        {
          relative_path: 'a/seed=42&step=500&cfg=3.png',
          dimensions: { seed: '42', step: '500', cfg: '3' },
          thumbnail_path: 'a/thumb/seed=42&step=500&cfg=3.jpg',
        },
        {
          relative_path: 'a/seed=42&step=500&cfg=7.png',
          dimensions: { seed: '42', step: '500', cfg: '7' },
          thumbnail_path: 'a/thumb/seed=42&step=500&cfg=7.jpg',
        },
      ]
      const wrapper = mountGrid({
        images: imagesWithThumbnails,
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      const imageCells = wrapper.findAllComponents(ImageCell)
      expect(imageCells.length).toBeGreaterThan(0)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      // imagesBySliderValue must point to full-resolution PNGs, not JPEG thumbnails
      expect(payload.imagesBySliderValue['3']).toBe('/api/images/a/seed=42&step=500&cfg=3.png')
      expect(payload.imagesBySliderValue['7']).toBe('/api/images/a/seed=42&step=500&cfg=7.png')
      // Must NOT contain JPEG thumbnail paths
      expect(payload.imagesBySliderValue['3']).not.toContain('.jpg')
      expect(payload.imagesBySliderValue['7']).not.toContain('.jpg')
    })

    it('gridImages imagesBySliderValue uses relative_path (PNG) not thumbnail_path (JPEG)', async () => {
      const imagesWithThumbnails: ScanImage[] = [
        {
          relative_path: 'a/seed=42&step=500&cfg=3.png',
          dimensions: { seed: '42', step: '500', cfg: '3' },
          thumbnail_path: 'a/thumb/seed=42&step=500&cfg=3.jpg',
        },
        {
          relative_path: 'a/seed=42&step=500&cfg=7.png',
          dimensions: { seed: '42', step: '500', cfg: '7' },
          thumbnail_path: 'a/thumb/seed=42&step=500&cfg=7.jpg',
        },
      ]
      const wrapper = mountGrid({
        images: imagesWithThumbnails,
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      const imageCells = wrapper.findAllComponents(ImageCell)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      // gridImages also carries imagesBySliderValue for navigation; these must be PNGs
      for (const navItem of payload.gridImages) {
        for (const url of Object.values(navItem.imagesBySliderValue)) {
          expect(url).not.toContain('.jpg')
          expect(url).toMatch(/\.png$/)
        }
      }
    })
  })

  describe('image:click emit payload shape', () => {
    // AC2: XYGrid image:click emit payload has cellKey, sliderValues, currentSliderValue,
    // imagesBySliderValue as defined by ImageClickContext
    it('emits image:click with correct ImageClickContext shape when a cell image is clicked', async () => {
      // Arrange: mount with X+Y dimensions and a slider dimension so all payload fields are populated
      const wrapper = mountGrid({
        sliderDimension,
        sliderValues: {},
        defaultSliderValue: '3',
      })

      // Act: trigger click on the first ImageCell (seed=42, step=500)
      const imageCells = wrapper.findAllComponents(ImageCell)
      expect(imageCells.length).toBeGreaterThan(0)
      // ImageCell emits 'click' with the imageUrl; XYGrid handles it via onImageClick
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      // Assert: image:click was emitted
      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      expect(emitted!.length).toBe(1)

      // Assert: payload conforms to ImageClickContext shape
      const payload = emitted![0][0] as ImageClickContext

      // cellKey: identifies the grid cell as "xVal|yVal"
      expect(payload).toHaveProperty('cellKey')
      expect(typeof payload.cellKey).toBe('string')
      expect(payload.cellKey).toBe('42|500')

      // sliderValues: ordered array of slider dimension values
      expect(payload).toHaveProperty('sliderValues')
      expect(Array.isArray(payload.sliderValues)).toBe(true)
      expect(payload.sliderValues).toEqual(['3', '7'])

      // currentSliderValue: the active slider value for this cell
      expect(payload).toHaveProperty('currentSliderValue')
      expect(typeof payload.currentSliderValue).toBe('string')
      expect(payload.currentSliderValue).toBe('3')

      // imagesBySliderValue: map from slider value → image URL for all slider positions in this cell
      expect(payload).toHaveProperty('imagesBySliderValue')
      expect(typeof payload.imagesBySliderValue).toBe('object')
      // Both cfg=3 and cfg=7 images exist for seed=42, step=500
      expect(payload.imagesBySliderValue).toHaveProperty('3')
      expect(payload.imagesBySliderValue).toHaveProperty('7')
      expect(payload.imagesBySliderValue['3']).toBe('/api/images/a/seed=42&step=500&cfg=3.png')
      expect(payload.imagesBySliderValue['7']).toBe('/api/images/a/seed=42&step=500&cfg=7.png')

      // imageUrl: the clicked image's full URL
      expect(payload).toHaveProperty('imageUrl')
      expect(payload.imageUrl).toBe('/api/images/a/seed=42&step=500&cfg=3.png')

      // gridImages: ordered list of all visible grid cells with images
      expect(payload).toHaveProperty('gridImages')
      expect(Array.isArray(payload.gridImages)).toBe(true)

      // gridIndex: index of this cell in gridImages
      expect(payload).toHaveProperty('gridIndex')
      expect(typeof payload.gridIndex).toBe('number')

      // gridColumnCount: number of X-axis columns for Y-axis keyboard navigation
      expect(payload).toHaveProperty('gridColumnCount')
      expect(typeof payload.gridColumnCount).toBe('number')
      // With an X dimension assigned, gridColumnCount should be > 0
      expect(payload.gridColumnCount).toBeGreaterThan(0)
    })

    it('emits image:click with empty sliderValues and imagesBySliderValue when no slider dimension', async () => {
      // AC2: Verify payload shape when slider dimension is not assigned
      const wrapper = mountGrid({
        sliderDimension: null,
        sliderValues: {},
        defaultSliderValue: '',
      })

      const imageCells = wrapper.findAllComponents(ImageCell)
      expect(imageCells.length).toBeGreaterThan(0)
      imageCells[0].vm.$emit('click', '/api/images/a/seed=42&step=500&cfg=3.png')
      await wrapper.vm.$nextTick()

      const emitted = wrapper.emitted('image:click')
      expect(emitted).toBeDefined()
      const payload = emitted![0][0] as ImageClickContext

      // cellKey is still a string
      expect(typeof payload.cellKey).toBe('string')
      expect(payload.cellKey).toBe('42|500')

      // sliderValues is empty array (no slider dimension)
      expect(Array.isArray(payload.sliderValues)).toBe(true)
      expect(payload.sliderValues).toHaveLength(0)

      // imagesBySliderValue is empty object (no slider dimension)
      expect(typeof payload.imagesBySliderValue).toBe('object')
      expect(Object.keys(payload.imagesBySliderValue)).toHaveLength(0)
    })
  })
})

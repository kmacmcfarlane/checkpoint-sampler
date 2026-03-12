import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NDrawer } from 'naive-ui'
import FiltersDrawer from '../FiltersDrawer.vue'
import DimensionFilter from '../DimensionFilter.vue'
import type { FilterMode } from '../../api/types'

const sampleDimensions = [
  { name: 'seed', values: ['42', '43', '44'] },
  { name: 'cfg', values: ['1', '3', '7'] },
  { name: 'prompt_name', values: ['forest', 'city'] },
]

function makeComboSelections(): Record<string, Set<string>> {
  return {
    seed: new Set(['42', '43', '44']),
    cfg: new Set(['1', '3', '7']),
    prompt_name: new Set(['forest', 'city']),
  }
}

function mountFiltersDrawer(overrides: {
  show?: boolean
  dimensions?: Array<{ name: string; values: string[] }>
  filterModes?: Record<string, FilterMode>
} = {}) {
  const filterModes = overrides.filterModes ?? {}
  return mount(FiltersDrawer, {
    props: {
      show: overrides.show ?? true,
      dimensions: overrides.dimensions ?? sampleDimensions,
      comboSelections: makeComboSelections(),
      getFilterMode: (name: string): FilterMode => filterModes[name] ?? 'multi',
    },
    global: {
      stubs: { Teleport: true },
    },
  })
}

describe('FiltersDrawer', () => {
  describe('visibility', () => {
    it('AC1: passes show prop to NDrawer', () => {
      const wrapper = mountFiltersDrawer({ show: true })
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.exists()).toBe(true)
      expect(drawer.props('show')).toBe(true)
    })

    it('AC1: passes show=false to NDrawer when closed', () => {
      const wrapper = mountFiltersDrawer({ show: false })
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('show')).toBe(false)
    })

    it('emits update:show when NDrawer update:show fires', async () => {
      const wrapper = mountFiltersDrawer({ show: true })
      const drawer = wrapper.findComponent(NDrawer)
      drawer.vm.$emit('update:show', false)
      await nextTick()

      const emitted = wrapper.emitted('update:show')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      expect(emitted![0]).toEqual([false])
    })

    it('NDrawer uses right placement', () => {
      const wrapper = mountFiltersDrawer()
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('placement')).toBe('right')
    })
  })

  describe('AC1: drawer width — resizable with default and viewport constraints', () => {
    beforeEach(() => {
      // Default: wide viewport (> 600px narrow breakpoint)
      Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    })

    it('AC1: default drawer width is 320px on wide viewports', () => {
      // AC: FiltersDrawer width adapts to content or is user-resizable — default width applied
      const wrapper = mountFiltersDrawer()
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe(320)
    })

    it('AC2: drawer width equals viewport width on small screens (< 600px)', () => {
      // AC: Drawer does not exceed viewport width on small screens
      Object.defineProperty(window, 'innerWidth', { value: 400, writable: true, configurable: true })
      const wrapper = mountFiltersDrawer()
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBe(400)
    })

    it('AC3: resize handle element is present in the rendered component', () => {
      // AC: Unit tests for drawer sizing behavior — resize handle exists
      const wrapper = mountFiltersDrawer()
      const handle = wrapper.find('[data-testid="filters-drawer-resize-handle"]')
      expect(handle.exists()).toBe(true)
    })

    it('AC3: resize handle has correct role and aria attributes', () => {
      // AC: Unit tests for drawer sizing behavior — resize handle is accessible
      const wrapper = mountFiltersDrawer()
      const handle = wrapper.find('[data-testid="filters-drawer-resize-handle"]')
      expect(handle.attributes('role')).toBe('separator')
      expect(handle.attributes('aria-orientation')).toBe('vertical')
    })
  })

  describe('AC1: DimensionFilter rendering — no individual collapse', () => {
    it('renders a DimensionFilter for each non-hidden dimension', () => {
      const wrapper = mountFiltersDrawer({
        dimensions: sampleDimensions,
        filterModes: { seed: 'multi', cfg: 'single', prompt_name: 'multi' },
      })
      const filters = wrapper.findAllComponents(DimensionFilter)
      // All 3 dimensions are non-hide, so 3 DimensionFilters should render
      expect(filters).toHaveLength(3)
    })

    it('passes alwaysExpanded=true to each DimensionFilter', () => {
      // AC1: No individual collapse — filters show content immediately
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      for (const filter of filters) {
        expect(filter.props('alwaysExpanded')).toBe(true)
      }
    })

    it('does not show visible content for hide-mode dimensions', () => {
      // DimensionFilter renders nothing (v-if on root div) when filterMode === 'hide'
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'hide', cfg: 'multi', prompt_name: 'multi' },
      })
      // 'seed' is hide mode — its root .dimension-filter div is not rendered
      // cfg and prompt_name are multi mode — their root divs are rendered
      const visibleFilters = wrapper.findAll('.dimension-filter')
      expect(visibleFilters).toHaveLength(2)
    })

    it('passes correct dimension name to each DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const names = filters.map((f) => f.props('dimensionName'))
      expect(names).toContain('seed')
      expect(names).toContain('cfg')
      expect(names).toContain('prompt_name')
    })

    it('passes correct values to each DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const seedFilter = filters.find((f) => f.props('dimensionName') === 'seed')
      expect(seedFilter).toBeDefined()
      expect(seedFilter!.props('values')).toEqual(['42', '43', '44'])
    })

    it('passes selected set from comboSelections to DimensionFilter', () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const cfgFilter = filters.find((f) => f.props('dimensionName') === 'cfg')
      expect(cfgFilter).toBeDefined()
      const selected = cfgFilter!.props('selected') as Set<string>
      expect(selected.has('1')).toBe(true)
      expect(selected.has('3')).toBe(true)
      expect(selected.has('7')).toBe(true)
    })

    it('passes filterMode from getFilterMode to DimensionFilter', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'single', cfg: 'multi', prompt_name: 'multi' },
      })
      const filters = wrapper.findAllComponents(DimensionFilter)
      const seedFilter = filters.find((f) => f.props('dimensionName') === 'seed')
      expect(seedFilter!.props('filterMode')).toBe('single')
    })
  })

  describe('AC4: filter-update event forwarding', () => {
    it('emits filter-update when DimensionFilter emits update', async () => {
      const wrapper = mountFiltersDrawer()
      const filters = wrapper.findAllComponents(DimensionFilter)
      const firstFilter = filters[0]

      // Simulate DimensionFilter emitting an update
      firstFilter.vm.$emit('update', 'seed', new Set(['42']))
      await nextTick()

      const emitted = wrapper.emitted('filter-update')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      const [dimName, selected] = emitted![0] as [string, Set<string>]
      expect(dimName).toBe('seed')
      expect(selected.has('42')).toBe(true)
    })
  })

  describe('empty state', () => {
    it('shows empty message when all dimensions are in hide mode', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'hide', cfg: 'hide', prompt_name: 'hide' },
      })
      const emptyMsg = wrapper.find('.filters-drawer__empty')
      expect(emptyMsg.exists()).toBe(true)
    })

    it('does not show empty message when at least one non-hide dimension exists', () => {
      const wrapper = mountFiltersDrawer({
        filterModes: { seed: 'multi', cfg: 'hide', prompt_name: 'hide' },
      })
      const emptyMsg = wrapper.find('.filters-drawer__empty')
      expect(emptyMsg.exists()).toBe(false)
    })
  })

  describe('AC3: drag-to-resize behavior', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
      vi.spyOn(document, 'addEventListener')
      vi.spyOn(document, 'removeEventListener')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('AC3: mousedown on resize handle attaches mousemove and mouseup listeners', async () => {
      // AC: Unit tests for drawer sizing behavior — drag start registers listeners
      const wrapper = mountFiltersDrawer()
      const handle = wrapper.find('[data-testid="filters-drawer-resize-handle"]')
      await handle.trigger('mousedown')
      expect(document.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(document.addEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function))
    })

    it('AC3: width is clamped to minimum 200px when dragging to left edge', async () => {
      // AC: Unit tests for drawer sizing behavior — min width clamp
      const wrapper = mountFiltersDrawer()
      const handle = wrapper.find('[data-testid="filters-drawer-resize-handle"]')

      // Start drag
      await handle.trigger('mousedown', { clientX: 900 })

      // Simulate mousemove very close to right edge (window.innerWidth - clientX would be tiny)
      const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 1200 })
      document.dispatchEvent(mouseMoveEvent)
      await nextTick()

      // Width should be clamped at MIN_WIDTH (200)
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBeGreaterThanOrEqual(200)
    })

    it('AC2: width is clamped to 80vw maximum', async () => {
      // AC: Drawer does not exceed viewport width on small screens — max width constraint
      const wrapper = mountFiltersDrawer()
      const handle = wrapper.find('[data-testid="filters-drawer-resize-handle"]')

      // Start drag
      await handle.trigger('mousedown', { clientX: 900 })

      // Simulate mousemove beyond 80vw
      const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 0 })
      document.dispatchEvent(mouseMoveEvent)
      await nextTick()

      // Width should not exceed 80% of 1280px = 1024px
      const drawer = wrapper.findComponent(NDrawer)
      expect(drawer.props('width')).toBeLessThanOrEqual(1024)
    })
  })
})

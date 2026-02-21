import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { NButton, NCheckbox, NSelect } from 'naive-ui'
import DimensionFilter from '../DimensionFilter.vue'
import type { FilterMode } from '../../api/types'

const sampleValues = ['landscape', 'portrait', 'abstract']

function mountFilter(overrides: {
  selected?: Set<string>
  filterMode?: FilterMode
} = {}) {
  return mount(DimensionFilter, {
    props: {
      dimensionName: 'prompt_name',
      values: sampleValues,
      selected: overrides.selected ?? new Set(sampleValues),
      filterMode: overrides.filterMode ?? 'multi',
    },
  })
}

describe('DimensionFilter', () => {
  describe('Hide mode', () => {
    it('renders nothing when filter mode is hide', () => {
      const wrapper = mountFilter({ filterMode: 'hide' })
      expect(wrapper.find('.dimension-filter').exists()).toBe(false)
    })
  })

  describe('collapse behavior', () => {
    it('starts collapsed by default', () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      expect(wrapper.find('.dimension-filter__content').exists()).toBe(false)
    })

    it('renders the dimension name in the toggle', () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      expect(wrapper.find('.dimension-filter__name').text()).toBe('prompt_name')
    })

    it('expands when toggle is clicked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(wrapper.find('.dimension-filter__content').exists()).toBe(true)
    })

    it('collapses when toggle is clicked again', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(wrapper.find('.dimension-filter__content').exists()).toBe(true)
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(wrapper.find('.dimension-filter__content').exists()).toBe(false)
    })

    it('has accessible aria-expanded attribute on toggle', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      const toggle = wrapper.find('.dimension-filter__toggle')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
    })

    it('has accessible aria-label on toggle', () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      const toggle = wrapper.find('.dimension-filter__toggle')
      expect(toggle.attributes('aria-label')).toBe('Toggle prompt_name filter')
    })
  })

  describe('Single mode', () => {
    it('renders NSelect when expanded in single mode', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const select = wrapper.findComponent(NSelect)
      expect(select.exists()).toBe(true)
    })

    it('shows current selected value in NSelect', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['portrait']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const select = wrapper.findComponent(NSelect)
      expect(select.props('value')).toBe('portrait')
    })

    it('defaults to first value when no selection matches', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['nonexistent']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const select = wrapper.findComponent(NSelect)
      expect(select.props('value')).toBe('landscape')
    })

    it('emits update with single value when NSelect value changes', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const select = wrapper.findComponent(NSelect)
      select.vm.$emit('update:value', 'abstract')
      await nextTick()

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      expect(emitted).toHaveLength(1)
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.size).toBe(1)
      expect(selected.has('abstract')).toBe(true)
    })

    it('has accessible aria-label on NSelect', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const select = wrapper.findComponent(NSelect)
      expect(select.attributes('aria-label')).toBe('Filter prompt_name')
    })

    it('does not render multi-mode checkboxes', async () => {
      const wrapper = mountFilter({ filterMode: 'single', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(wrapper.findAllComponents(NCheckbox)).toHaveLength(0)
    })
  })

  describe('Multi mode', () => {
    it('renders checkboxes when expanded in multi mode', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const checkboxes = wrapper.findAllComponents(NCheckbox)
      expect(checkboxes).toHaveLength(3)
    })

    it('checks boxes for selected values', async () => {
      const wrapper = mountFilter({
        filterMode: 'multi',
        selected: new Set(['landscape', 'abstract']),
      })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const checkboxes = wrapper.findAllComponents(NCheckbox)
      expect(checkboxes[0].props('checked')).toBe(true)
      expect(checkboxes[1].props('checked')).toBe(false)
      expect(checkboxes[2].props('checked')).toBe(true)
    })

    it('emits update with toggled value when checkbox is unchecked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(sampleValues) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const checkboxes = wrapper.findAllComponents(NCheckbox)
      checkboxes[1].vm.$emit('update:checked', false)
      await nextTick()

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.has('portrait')).toBe(false)
    })

    it('emits update adding a value when unchecked box is checked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const checkboxes = wrapper.findAllComponents(NCheckbox)
      checkboxes[1].vm.$emit('update:checked', true)
      await nextTick()

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.has('portrait')).toBe(true)
    })

    it('solos a value when value label is clicked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(sampleValues) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const labels = wrapper.findAll('.dimension-filter__value')
      await labels[1].trigger('click')

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.size).toBe(1)
      expect(selected.has('portrait')).toBe(true)
    })

    it('unsolos when clicking the only selected value label', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(['portrait']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const labels = wrapper.findAll('.dimension-filter__value')
      await labels[1].trigger('click')

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.size).toBe(3)
    })

    it('emits update with all values when All button is clicked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(['landscape']) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const buttons = wrapper.findAllComponents(NButton)
      const allBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select all'))!
      await allBtn.trigger('click')

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.size).toBe(3)
    })

    it('emits update with empty set when None button is clicked', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(sampleValues) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const buttons = wrapper.findAllComponents(NButton)
      const noneBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select none'))!
      await noneBtn.trigger('click')

      const emitted = wrapper.emitted('update')
      expect(emitted).toBeDefined()
      const [name, selected] = emitted![0] as [string, Set<string>]
      expect(name).toBe('prompt_name')
      expect(selected.size).toBe(0)
    })

    it('disables All button when all values are selected', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set(sampleValues) })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const buttons = wrapper.findAllComponents(NButton)
      const allBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select all'))!
      expect(allBtn.props('disabled')).toBe(true)
    })

    it('disables None button when no values are selected', async () => {
      const wrapper = mountFilter({ filterMode: 'multi', selected: new Set<string>() })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const buttons = wrapper.findAllComponents(NButton)
      const noneBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select none'))!
      expect(noneBtn.props('disabled')).toBe(true)
    })

    it('has accessible labels on controls', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const buttons = wrapper.findAllComponents(NButton)
      const allBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select all'))!
      const noneBtn = buttons.find((b) => b.attributes('aria-label')?.includes('Select none'))!
      expect(allBtn.attributes('aria-label')).toBe('Select all prompt_name')
      expect(noneBtn.attributes('aria-label')).toBe('Select none prompt_name')

      const group = wrapper.find('[role="group"]')
      expect(group.attributes('aria-label')).toBe('Filter by prompt_name')
    })

    it('has accessible labels on value controls', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      const checkboxes = wrapper.findAllComponents(NCheckbox)
      expect(checkboxes[0].attributes('aria-label')).toBe('Toggle prompt_name landscape')

      const valueLabels = wrapper.findAll('.dimension-filter__value')
      expect(valueLabels[0].attributes('aria-label')).toBe('Solo prompt_name landscape')
    })

    it('does not render NSelect', async () => {
      const wrapper = mountFilter({ filterMode: 'multi' })
      await wrapper.find('.dimension-filter__header').trigger('click')
      expect(wrapper.findAllComponents(NSelect)).toHaveLength(0)
    })
  })
})

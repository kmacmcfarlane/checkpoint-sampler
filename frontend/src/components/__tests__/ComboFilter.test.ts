import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ComboFilter from '../ComboFilter.vue'

const sampleValues = ['landscape', 'portrait', 'abstract']

function mountFilter(overrides: { selected?: Set<string> } = {}) {
  return mount(ComboFilter, {
    props: {
      dimensionName: 'prompt_name',
      values: sampleValues,
      selected: overrides.selected ?? new Set(sampleValues),
    },
  })
}

describe('ComboFilter', () => {
  it('renders the dimension name', () => {
    const wrapper = mountFilter()
    expect(wrapper.find('.combo-filter__name').text()).toBe('prompt_name')
  })

  it('renders a checkbox for each value', () => {
    const wrapper = mountFilter()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(3)
  })

  it('displays value labels', () => {
    const wrapper = mountFilter()
    const labels = wrapper.findAll('.combo-filter__value')
    expect(labels.map((l) => l.text())).toEqual(['landscape', 'portrait', 'abstract'])
  })

  it('checks boxes for selected values', () => {
    const wrapper = mountFilter({ selected: new Set(['landscape', 'abstract']) })
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[2].element as HTMLInputElement).checked).toBe(true)
  })

  it('emits update with toggled value when checkbox is changed', async () => {
    const wrapper = mountFilter({ selected: new Set(sampleValues) })
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[1].setValue(false)

    const emitted = wrapper.emitted('update')
    expect(emitted).toBeDefined()
    expect(emitted).toHaveLength(1)
    const [name, selected] = emitted![0] as [string, Set<string>]
    expect(name).toBe('prompt_name')
    expect(selected.has('landscape')).toBe(true)
    expect(selected.has('portrait')).toBe(false)
    expect(selected.has('abstract')).toBe(true)
  })

  it('emits update adding a value when unchecked box is checked', async () => {
    const wrapper = mountFilter({ selected: new Set(['landscape']) })
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[1].setValue(true)

    const emitted = wrapper.emitted('update')
    expect(emitted).toBeDefined()
    const [name, selected] = emitted![0] as [string, Set<string>]
    expect(name).toBe('prompt_name')
    expect(selected.has('landscape')).toBe(true)
    expect(selected.has('portrait')).toBe(true)
  })

  it('emits update with single value when value label is clicked', async () => {
    const wrapper = mountFilter({ selected: new Set(sampleValues) })
    const labels = wrapper.findAll('.combo-filter__value')
    await labels[1].trigger('click')

    const emitted = wrapper.emitted('update')
    expect(emitted).toBeDefined()
    const [name, selected] = emitted![0] as [string, Set<string>]
    expect(name).toBe('prompt_name')
    expect(selected.size).toBe(1)
    expect(selected.has('portrait')).toBe(true)
  })

  it('emits update with all values when All button is clicked', async () => {
    const wrapper = mountFilter({ selected: new Set(['landscape']) })
    const allBtn = wrapper.findAll('.combo-filter__btn')[0]
    await allBtn.trigger('click')

    const emitted = wrapper.emitted('update')
    expect(emitted).toBeDefined()
    const [name, selected] = emitted![0] as [string, Set<string>]
    expect(name).toBe('prompt_name')
    expect(selected.size).toBe(3)
  })

  it('emits update with empty set when None button is clicked', async () => {
    const wrapper = mountFilter({ selected: new Set(sampleValues) })
    const noneBtn = wrapper.findAll('.combo-filter__btn')[1]
    await noneBtn.trigger('click')

    const emitted = wrapper.emitted('update')
    expect(emitted).toBeDefined()
    const [name, selected] = emitted![0] as [string, Set<string>]
    expect(name).toBe('prompt_name')
    expect(selected.size).toBe(0)
  })

  it('disables All button when all values are selected', () => {
    const wrapper = mountFilter({ selected: new Set(sampleValues) })
    const allBtn = wrapper.findAll('.combo-filter__btn')[0]
    expect((allBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables None button when no values are selected', () => {
    const wrapper = mountFilter({ selected: new Set<string>() })
    const noneBtn = wrapper.findAll('.combo-filter__btn')[1]
    expect((noneBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables All button when not all values are selected', () => {
    const wrapper = mountFilter({ selected: new Set(['landscape']) })
    const allBtn = wrapper.findAll('.combo-filter__btn')[0]
    expect((allBtn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('enables None button when some values are selected', () => {
    const wrapper = mountFilter({ selected: new Set(['landscape']) })
    const noneBtn = wrapper.findAll('.combo-filter__btn')[1]
    expect((noneBtn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('has accessible labels on controls', () => {
    const wrapper = mountFilter()
    const allBtn = wrapper.findAll('.combo-filter__btn')[0]
    const noneBtn = wrapper.findAll('.combo-filter__btn')[1]
    expect(allBtn.attributes('aria-label')).toBe('Select all prompt_name')
    expect(noneBtn.attributes('aria-label')).toBe('Select none prompt_name')

    const group = wrapper.find('[role="group"]')
    expect(group.attributes('aria-label')).toBe('Filter by prompt_name')
  })

  it('has accessible labels on value controls', () => {
    const wrapper = mountFilter()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes[0].attributes('aria-label')).toBe('Toggle prompt_name landscape')

    const valueLabels = wrapper.findAll('.combo-filter__value')
    expect(valueLabels[0].attributes('aria-label')).toBe('Select only prompt_name landscape')
  })

  it('renders empty list when no values provided', () => {
    const wrapper = mount(ComboFilter, {
      props: {
        dimensionName: 'empty_dim',
        values: [],
        selected: new Set<string>(),
      },
    })
    const items = wrapper.findAll('.combo-filter__item')
    expect(items).toHaveLength(0)
  })
})

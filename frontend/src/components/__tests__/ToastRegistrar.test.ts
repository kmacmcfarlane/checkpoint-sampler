import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { NMessageProvider } from 'naive-ui'
import ToastRegistrar from '../ToastRegistrar.vue'
import { useToast, resetMessageApi } from '../../composables/useToast'

// Host that mirrors App.vue's wiring: ToastRegistrar mounted inside a real
// <n-message-provider>. This is an integration test of the full toast layer
// (no naive-ui mock), so a toast fired via useToast() actually renders.
const Host = defineComponent({
  components: { NMessageProvider, ToastRegistrar },
  template: '<NMessageProvider><ToastRegistrar /></NMessageProvider>',
})

afterEach(() => {
  resetMessageApi()
})

describe('ToastRegistrar (toast layer integration)', () => {
  it('registers the message API so useToast() surfaces a visible message', async () => {
    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { stubs: { Teleport: false } },
    })
    await flushPromises()

    // Fire a toast the way App.vue's job-control handlers do.
    useToast().error('Failed to stop sample job. Please try again.')
    await nextTick()
    await flushPromises()

    expect(document.body.textContent).toContain('Failed to stop sample job')

    // The registrar itself renders no visible text (only a hidden placeholder).
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

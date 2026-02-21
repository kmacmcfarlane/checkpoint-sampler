import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { useTheme } from '../useTheme'

const STORAGE_KEY = 'checkpoint-sampler-theme'

/** Helper component to mount the composable in a real component lifecycle. */
function mountTheme() {
  let result!: ReturnType<typeof useTheme>
  const Wrapper = defineComponent({
    setup() {
      result = useTheme()
      return { ...result }
    },
    template: '<div></div>',
  })
  const wrapper = mount(Wrapper)
  return { wrapper, result }
}

describe('useTheme', () => {
  let matchMediaListeners: Array<(e: MediaQueryListEvent) => void>
  let matchMediaMatches: boolean

  beforeEach(() => {
    localStorage.clear()
    document.body.classList.remove('dark-theme')
    matchMediaListeners = []
    matchMediaMatches = false

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: matchMediaMatches,
      media: query,
      addEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners.push(cb)
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to light mode when no localStorage and system prefers light', () => {
    matchMediaMatches = false
    const { result } = mountTheme()
    expect(result.mode.value).toBe('light')
    expect(result.isDark.value).toBe(false)
    expect(result.theme.value).toBeNull()
  })

  it('defaults to dark mode when system prefers dark', () => {
    matchMediaMatches = true
    const { result } = mountTheme()
    expect(result.mode.value).toBe('dark')
    expect(result.isDark.value).toBe(true)
    expect(result.theme.value).not.toBeNull()
  })

  it('restores dark mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    const { result } = mountTheme()
    expect(result.mode.value).toBe('dark')
    expect(result.isDark.value).toBe(true)
  })

  it('restores light mode from localStorage even when system prefers dark', () => {
    matchMediaMatches = true
    localStorage.setItem(STORAGE_KEY, 'light')
    const { result } = mountTheme()
    expect(result.mode.value).toBe('light')
    expect(result.isDark.value).toBe(false)
  })

  it('toggle switches from light to dark', () => {
    const { result } = mountTheme()
    expect(result.mode.value).toBe('light')
    result.toggle()
    expect(result.mode.value).toBe('dark')
    expect(result.isDark.value).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('toggle switches from dark to light', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    const { result } = mountTheme()
    expect(result.mode.value).toBe('dark')
    result.toggle()
    expect(result.mode.value).toBe('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('persists theme choice to localStorage on toggle', () => {
    const { result } = mountTheme()
    result.toggle()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    result.toggle()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('setMode sets a specific theme', () => {
    const { result } = mountTheme()
    result.setMode('dark')
    expect(result.mode.value).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    result.setMode('light')
    expect(result.mode.value).toBe('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('applies dark-theme class to body in dark mode', async () => {
    const { result } = mountTheme()
    await flushPromises()
    expect(document.body.classList.contains('dark-theme')).toBe(false)
    result.toggle()
    expect(document.body.classList.contains('dark-theme')).toBe(true)
  })

  it('removes dark-theme class from body when switching to light', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    const { result } = mountTheme()
    await flushPromises()
    expect(document.body.classList.contains('dark-theme')).toBe(true)
    result.toggle()
    expect(document.body.classList.contains('dark-theme')).toBe(false)
  })

  it('follows system preference changes when user has not explicitly chosen', async () => {
    const { result } = mountTheme()
    await flushPromises()
    expect(result.mode.value).toBe('light')

    // Simulate system switching to dark
    for (const listener of matchMediaListeners) {
      listener({ matches: true } as MediaQueryListEvent)
    }
    await nextTick()
    expect(result.mode.value).toBe('dark')
  })

  it('ignores system preference changes when user has explicitly chosen', async () => {
    const { result } = mountTheme()
    await flushPromises()
    result.toggle() // explicitly choose dark
    expect(result.mode.value).toBe('dark')

    // Simulate system switching to light
    for (const listener of matchMediaListeners) {
      listener({ matches: false } as MediaQueryListEvent)
    }
    await nextTick()
    expect(result.mode.value).toBe('dark') // stays dark because user chose
  })

  it('returns darkTheme for dark mode and null for light mode', () => {
    const { result } = mountTheme()
    expect(result.theme.value).toBeNull()
    result.toggle()
    expect(result.theme.value).not.toBeNull()
    expect(result.theme.value).toHaveProperty('name', 'dark')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid')
    matchMediaMatches = false
    const { result } = mountTheme()
    expect(result.mode.value).toBe('light')
  })
})

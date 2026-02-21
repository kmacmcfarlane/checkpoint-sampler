import { ref, computed, onMounted, onUnmounted } from 'vue'
import { darkTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'checkpoint-sampler-theme'

/**
 * Composable for managing dark/light theme state.
 *
 * - Defaults to the browser's prefers-color-scheme preference
 * - Persists the user's choice in localStorage
 * - Returns the Naive UI theme object for NConfigProvider
 */
export function useTheme() {
  const mode = ref<ThemeMode>(getInitialMode())

  const theme = computed<GlobalTheme | null>(() =>
    mode.value === 'dark' ? darkTheme : null,
  )

  const isDark = computed(() => mode.value === 'dark')

  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, mode.value)
    applyBodyClass(mode.value)
  }

  function setMode(newMode: ThemeMode) {
    mode.value = newMode
    localStorage.setItem(STORAGE_KEY, newMode)
    applyBodyClass(newMode)
  }

  let mediaQuery: MediaQueryList | null = null
  function onSystemChange(e: MediaQueryListEvent) {
    // Only follow system changes if the user hasn't explicitly chosen
    if (!localStorage.getItem(STORAGE_KEY)) {
      const newMode: ThemeMode = e.matches ? 'dark' : 'light'
      mode.value = newMode
      applyBodyClass(newMode)
    }
  }

  onMounted(() => {
    applyBodyClass(mode.value)
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', onSystemChange)
  })

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', onSystemChange)
    }
  })

  return { mode, theme, isDark, toggle, setMode }
}

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function applyBodyClass(mode: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('dark-theme', mode === 'dark')
  }
}

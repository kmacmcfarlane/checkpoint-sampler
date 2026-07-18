import { useMessage } from 'naive-ui'
import type { MessageApi } from 'naive-ui'

/**
 * Module-level singleton reference to the Naive UI message API.
 *
 * Naive UI's `useMessage()` only works inside a component setup that is a
 * descendant of an `<n-message-provider>`. App.vue hosts that provider in its
 * own template, so App.vue's own setup logic (job controls) is NOT a descendant
 * and cannot call `useMessage()` directly. To bridge that gap we register the
 * API once via a small injector component mounted inside the provider, then let
 * any component (or App.vue setup) fire toasts through `useToast()`.
 */
let messageApi: MessageApi | null = null

/**
 * Register the Naive UI message API. Call this from a component that is a
 * descendant of `<n-message-provider>` (see ToastProvider usage in App.vue).
 */
export function registerMessageApi(): void {
  messageApi = useMessage()
}

/** Reset the registered API (test cleanup). */
export function resetMessageApi(): void {
  messageApi = null
}

/**
 * Toast helper. Returns functions that surface user-visible messages via the
 * registered Naive UI message API. Each is a no-op if the provider has not yet
 * registered (e.g. before mount), so callers never crash.
 */
export function useToast() {
  return {
    error(content: string): void {
      messageApi?.error(content)
    },
    success(content: string): void {
      messageApi?.success(content)
    },
    warning(content: string): void {
      messageApi?.warning(content)
    },
    info(content: string): void {
      messageApi?.info(content)
    },
  }
}

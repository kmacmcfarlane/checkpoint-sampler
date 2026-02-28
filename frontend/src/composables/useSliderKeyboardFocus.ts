/**
 * Global singleton that ensures only one MasterSlider captures document-level
 * keyboard input at a time. When multiple MasterSlider components are mounted,
 * the most recently focused (or last-registered) instance wins.
 *
 * Usage inside MasterSlider:
 *   const { isActive, claim, release, register, unregister } = useSliderKeyboardFocus()
 *   // On mount: register(id)
 *   // On focus/click: claim(id)
 *   // On unmount: unregister(id)
 *   // In document keydown handler: if (!isActive(id)) return
 */

/** Stack of registered slider instance IDs. The last entry is the active one. */
const instanceStack: string[] = []

let idCounter = 0

/**
 * Generate a unique ID for a MasterSlider instance.
 */
export function generateSliderId(): string {
  return `master-slider-${++idCounter}`
}

/**
 * Register a new slider instance. The new instance becomes active (pushed to
 * the top of the stack).
 */
export function registerSlider(id: string): void {
  // Avoid duplicate registration
  const idx = instanceStack.indexOf(id)
  if (idx >= 0) {
    instanceStack.splice(idx, 1)
  }
  instanceStack.push(id)
}

/**
 * Unregister a slider instance (called on unmount).
 */
export function unregisterSlider(id: string): void {
  const idx = instanceStack.indexOf(id)
  if (idx >= 0) {
    instanceStack.splice(idx, 1)
  }
}

/**
 * Claim keyboard focus for a specific slider instance (e.g. on click/focus).
 * Moves the instance to the top of the stack.
 */
export function claimSliderFocus(id: string): void {
  const idx = instanceStack.indexOf(id)
  if (idx >= 0) {
    instanceStack.splice(idx, 1)
  }
  instanceStack.push(id)
}

/**
 * Check whether a specific slider instance is the currently active one
 * (i.e. at the top of the stack).
 */
export function isSliderActive(id: string): boolean {
  return instanceStack.length > 0 && instanceStack[instanceStack.length - 1] === id
}

/**
 * Return the current number of registered instances (useful for testing).
 */
export function getRegisteredCount(): number {
  return instanceStack.length
}

/**
 * Reset all state. Only intended for testing — NOT for production use.
 */
export function _resetForTesting(): void {
  instanceStack.length = 0
  idCounter = 0
}

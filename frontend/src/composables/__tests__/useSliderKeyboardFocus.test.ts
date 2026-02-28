import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateSliderId,
  registerSlider,
  unregisterSlider,
  claimSliderFocus,
  isSliderActive,
  getRegisteredCount,
  _resetForTesting,
} from '../useSliderKeyboardFocus'

describe('useSliderKeyboardFocus', () => {
  beforeEach(() => {
    _resetForTesting()
  })

  // AC2: Global singleton or priority system determines which slider is active
  describe('generateSliderId', () => {
    it('generates unique IDs for each call', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      const id3 = generateSliderId()
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })
  })

  describe('registerSlider / unregisterSlider', () => {
    it('registers an instance and makes it active', () => {
      const id = generateSliderId()
      registerSlider(id)
      expect(isSliderActive(id)).toBe(true)
      expect(getRegisteredCount()).toBe(1)
    })

    it('unregisters an instance', () => {
      const id = generateSliderId()
      registerSlider(id)
      unregisterSlider(id)
      expect(getRegisteredCount()).toBe(0)
      expect(isSliderActive(id)).toBe(false)
    })

    it('handles unregistering a non-existent ID gracefully', () => {
      unregisterSlider('nonexistent')
      expect(getRegisteredCount()).toBe(0)
    })

    it('does not duplicate registration if called twice with same ID', () => {
      const id = generateSliderId()
      registerSlider(id)
      registerSlider(id)
      expect(getRegisteredCount()).toBe(1)
    })
  })

  // AC1: Only one captures keyboard input when multiple are mounted
  describe('active instance selection', () => {
    it('the last registered instance is active', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      registerSlider(id1)
      registerSlider(id2)
      expect(isSliderActive(id1)).toBe(false)
      expect(isSliderActive(id2)).toBe(true)
    })

    it('when the active instance is unregistered, the previous one becomes active', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      registerSlider(id1)
      registerSlider(id2)
      unregisterSlider(id2)
      expect(isSliderActive(id1)).toBe(true)
      expect(getRegisteredCount()).toBe(1)
    })

    it('when the first (non-active) instance is unregistered, active remains unchanged', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      registerSlider(id1)
      registerSlider(id2)
      unregisterSlider(id1)
      expect(isSliderActive(id2)).toBe(true)
      expect(getRegisteredCount()).toBe(1)
    })
  })

  describe('claimSliderFocus', () => {
    it('moves a previously non-active instance to the top of the stack', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      registerSlider(id1)
      registerSlider(id2)
      expect(isSliderActive(id2)).toBe(true)

      claimSliderFocus(id1)
      expect(isSliderActive(id1)).toBe(true)
      expect(isSliderActive(id2)).toBe(false)
    })

    it('claiming focus for the already-active instance is a no-op', () => {
      const id = generateSliderId()
      registerSlider(id)
      claimSliderFocus(id)
      expect(isSliderActive(id)).toBe(true)
      expect(getRegisteredCount()).toBe(1)
    })

    it('works with three instances', () => {
      const id1 = generateSliderId()
      const id2 = generateSliderId()
      const id3 = generateSliderId()
      registerSlider(id1)
      registerSlider(id2)
      registerSlider(id3)

      // id3 is active (last registered)
      expect(isSliderActive(id3)).toBe(true)

      // Claim focus for id1
      claimSliderFocus(id1)
      expect(isSliderActive(id1)).toBe(true)
      expect(isSliderActive(id2)).toBe(false)
      expect(isSliderActive(id3)).toBe(false)

      // Claim focus for id2
      claimSliderFocus(id2)
      expect(isSliderActive(id2)).toBe(true)
      expect(isSliderActive(id1)).toBe(false)
    })
  })

  describe('isSliderActive', () => {
    it('returns false when no instances are registered', () => {
      expect(isSliderActive('anything')).toBe(false)
    })

    it('returns false for an unregistered ID', () => {
      const id = generateSliderId()
      registerSlider(id)
      expect(isSliderActive('other')).toBe(false)
    })
  })

  describe('_resetForTesting', () => {
    it('clears all state', () => {
      registerSlider(generateSliderId())
      registerSlider(generateSliderId())
      _resetForTesting()
      expect(getRegisteredCount()).toBe(0)
    })
  })
})

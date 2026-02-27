import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WSClient } from '../wsClient'

/**
 * Minimal mock WebSocket that mimics the browser WebSocket API.
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(public url: string) {}

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  simulateError() {
    this.onerror?.(new Event('error'))
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }
}

// Patch the global WebSocket constants for readyState comparisons
Object.defineProperty(globalThis, 'WebSocket', {
  value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
  writable: true,
})

describe('WSClient', () => {
  let mockInstances: MockWebSocket[]
  let createWebSocket: (url: string) => MockWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    mockInstances = []
    createWebSocket = (url: string) => {
      const ws = new MockWebSocket(url)
      mockInstances.push(ws)
      return ws as unknown as WebSocket
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createClient(overrides: Record<string, unknown> = {}) {
    return new WSClient({
      url: 'ws://test/api/ws',
      createWebSocket: createWebSocket as unknown as (url: string) => WebSocket,
      initialDelay: 100,
      maxDelay: 1600,
      backoffMultiplier: 2,
      ...overrides,
    })
  }

  describe('connect', () => {
    it('creates a WebSocket connection to the configured URL', () => {
      const client = createClient()
      client.connect()

      expect(mockInstances).toHaveLength(1)
      expect(mockInstances[0].url).toBe('ws://test/api/ws')
    })

    it('reports connected state after open', () => {
      const client = createClient()
      client.connect()
      expect(client.connected).toBe(false)

      mockInstances[0].simulateOpen()
      expect(client.connected).toBe(true)
    })

    it('notifies connection state listeners on open', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onConnectionChange(listener)
      client.connect()

      mockInstances[0].simulateOpen()
      expect(listener).toHaveBeenCalledWith(true)
    })
  })

  describe('disconnect', () => {
    it('closes the WebSocket and stops reconnecting', () => {
      const client = createClient()
      client.connect()
      mockInstances[0].simulateOpen()

      client.disconnect()
      expect(client.connected).toBe(false)
    })

    it('notifies connection state listeners on close', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onConnectionChange(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      listener.mockClear()
      // Simulate close event (happens as part of WS lifecycle)
      mockInstances[0].simulateClose()
      expect(listener).toHaveBeenCalledWith(false)
    })

    it('does not reconnect after intentional disconnect', () => {
      const client = createClient()
      client.connect()
      mockInstances[0].simulateOpen()

      client.disconnect()
      vi.advanceTimersByTime(10000)
      // Should only have the initial connection
      expect(mockInstances).toHaveLength(1)
    })
  })

  describe('event dispatching', () => {
    it('dispatches valid FSEvent messages to listeners', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({ type: 'image_added', path: 'checkpoint.safetensors/test.png' }),
      )

      expect(listener).toHaveBeenCalledWith({
        type: 'image_added',
        path: 'checkpoint.safetensors/test.png',
      })
    })

    it('dispatches image_removed events', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({ type: 'image_removed', path: 'checkpoint.safetensors/test.png' }),
      )

      expect(listener).toHaveBeenCalledWith({
        type: 'image_removed',
        path: 'checkpoint.safetensors/test.png',
      })
    })

    it('dispatches directory_added events', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({ type: 'directory_added', path: 'new-checkpoint.safetensors' }),
      )

      expect(listener).toHaveBeenCalledWith({
        type: 'directory_added',
        path: 'new-checkpoint.safetensors',
      })
    })

    it('ignores non-JSON messages', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage('not json')
      expect(listener).not.toHaveBeenCalled()
    })

    it('ignores messages with invalid event type', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(JSON.stringify({ type: 'unknown_event', path: '/test' }))
      expect(listener).not.toHaveBeenCalled()
    })

    it('ignores messages missing required fields', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(JSON.stringify({ type: 'image_added' }))
      expect(listener).not.toHaveBeenCalled()
    })

    it('ignores non-string data', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      // Simulate binary data (Blob)
      mockInstances[0].onmessage?.(new MessageEvent('message', { data: new Blob() }))
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('job progress event dispatching', () => {
    it('dispatches valid job progress messages to job listeners', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          failed_items: 3,
          pending_items: 47,
          checkpoints_completed: 2,
          total_checkpoints: 5,
          current_checkpoint: 'checkpoint_00002.safetensors',
          current_checkpoint_progress: 10,
          current_checkpoint_total: 20,
        }),
      )

      expect(jobListener).toHaveBeenCalledWith({
        type: 'job_progress',
        job_id: 'job-123',
        status: 'running',
        total_items: 100,
        completed_items: 50,
        failed_items: 3,
        pending_items: 47,
        checkpoints_completed: 2,
        total_checkpoints: 5,
        current_checkpoint: 'checkpoint_00002.safetensors',
        current_checkpoint_progress: 10,
        current_checkpoint_total: 20,
      })
    })

    it('does not dispatch job progress messages to FS event listeners', () => {
      const client = createClient()
      const fsListener = vi.fn()
      client.onEvent(fsListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          failed_items: 0,
          pending_items: 50,
          checkpoints_completed: 2,
          total_checkpoints: 5,
        }),
      )

      expect(fsListener).not.toHaveBeenCalled()
    })

    it('does not dispatch FS events to job progress listeners', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({ type: 'image_added', path: 'test.png' }),
      )

      expect(jobListener).not.toHaveBeenCalled()
    })

    it('ignores job progress messages missing required job_id field', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          checkpoints_completed: 2,
          total_checkpoints: 5,
        }),
      )

      expect(jobListener).not.toHaveBeenCalled()
    })

    it('ignores job progress messages missing required status field', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          total_items: 100,
          completed_items: 50,
          checkpoints_completed: 2,
          total_checkpoints: 5,
        }),
      )

      expect(jobListener).not.toHaveBeenCalled()
    })

    it('ignores job progress messages missing required checkpoints_completed field', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          total_checkpoints: 5,
        }),
      )

      expect(jobListener).not.toHaveBeenCalled()
    })

    it('ignores job progress messages missing required total_checkpoints field', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          checkpoints_completed: 2,
        }),
      )

      expect(jobListener).not.toHaveBeenCalled()
    })

    it('accepts job progress messages with optional fields omitted', () => {
      const client = createClient()
      const jobListener = vi.fn()
      client.onJobProgress(jobListener)
      client.connect()
      mockInstances[0].simulateOpen()

      // Optional fields: current_checkpoint, current_checkpoint_progress, current_checkpoint_total
      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          failed_items: 0,
          pending_items: 50,
          checkpoints_completed: 2,
          total_checkpoints: 5,
        }),
      )

      expect(jobListener).toHaveBeenCalledWith({
        type: 'job_progress',
        job_id: 'job-123',
        status: 'running',
        total_items: 100,
        completed_items: 50,
        failed_items: 0,
        pending_items: 50,
        checkpoints_completed: 2,
        total_checkpoints: 5,
      })
    })
  })

  describe('listener management', () => {
    it('removes event listener with offEvent', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onEvent(listener)
      client.offEvent(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({ type: 'image_added', path: 'test.png' }),
      )
      expect(listener).not.toHaveBeenCalled()
    })

    it('removes connection state listener with offConnectionChange', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onConnectionChange(listener)
      client.offConnectionChange(listener)
      client.connect()
      mockInstances[0].simulateOpen()
      expect(listener).not.toHaveBeenCalled()
    })

    it('removes job progress listener with offJobProgress', () => {
      const client = createClient()
      const listener = vi.fn()
      client.onJobProgress(listener)
      client.offJobProgress(listener)
      client.connect()
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'job_progress',
          job_id: 'job-123',
          status: 'running',
          total_items: 100,
          completed_items: 50,
          checkpoints_completed: 2,
          total_checkpoints: 5,
        }),
      )
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('auto-reconnect', () => {
    it('reconnects after connection close with initial delay', () => {
      const client = createClient()
      client.connect()
      mockInstances[0].simulateOpen()
      mockInstances[0].simulateClose()

      expect(mockInstances).toHaveLength(1)

      vi.advanceTimersByTime(100)
      expect(mockInstances).toHaveLength(2)
    })

    it('applies exponential backoff on repeated failures', () => {
      const client = createClient()
      client.connect()

      // First connection fails immediately
      mockInstances[0].simulateClose()
      expect(mockInstances).toHaveLength(1)

      // After initial delay (100ms): reconnect attempt
      vi.advanceTimersByTime(100)
      expect(mockInstances).toHaveLength(2)

      // Second connection fails
      mockInstances[1].simulateClose()

      // After doubled delay (200ms): reconnect attempt
      vi.advanceTimersByTime(199)
      expect(mockInstances).toHaveLength(2)
      vi.advanceTimersByTime(1)
      expect(mockInstances).toHaveLength(3)

      // Third connection fails
      mockInstances[2].simulateClose()

      // After quadrupled delay (400ms): reconnect attempt
      vi.advanceTimersByTime(399)
      expect(mockInstances).toHaveLength(3)
      vi.advanceTimersByTime(1)
      expect(mockInstances).toHaveLength(4)
    })

    it('caps backoff delay at maxDelay', () => {
      const client = createClient()
      client.connect()

      // Fail repeatedly to exceed maxDelay
      for (let i = 0; i < 10; i++) {
        mockInstances[mockInstances.length - 1].simulateClose()
        vi.advanceTimersByTime(2000) // More than maxDelay
      }

      // Should still be reconnecting but delay should never exceed maxDelay (1600ms)
      const count = mockInstances.length
      mockInstances[mockInstances.length - 1].simulateClose()

      vi.advanceTimersByTime(1599)
      expect(mockInstances).toHaveLength(count)
      vi.advanceTimersByTime(1)
      expect(mockInstances).toHaveLength(count + 1)
    })

    it('resets backoff delay after successful connection', () => {
      const client = createClient()
      client.connect()

      // Fail once, causing delay to increase
      mockInstances[0].simulateClose()
      vi.advanceTimersByTime(100)
      expect(mockInstances).toHaveLength(2)

      // Second connection succeeds
      mockInstances[1].simulateOpen()
      // Then closes
      mockInstances[1].simulateClose()

      // Should reconnect after initial delay (100ms), not doubled delay (200ms)
      vi.advanceTimersByTime(100)
      expect(mockInstances).toHaveLength(3)
    })

    it('reconnects after WebSocket error', () => {
      const client = createClient()
      client.connect()
      mockInstances[0].simulateOpen()

      // Error followed by close (standard browser behavior)
      mockInstances[0].simulateError()
      mockInstances[0].simulateClose()

      vi.advanceTimersByTime(100)
      expect(mockInstances).toHaveLength(2)
    })
  })
})

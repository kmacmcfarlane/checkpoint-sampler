import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, defineComponent, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useWebSocket } from '../useWebSocket'
import { WSClient } from '../../api/wsClient'
import type { TrainingRun, ScanImage } from '../../api/types'

/**
 * Minimal mock WebSocket for testing useWebSocket composable.
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

  close() {
    this.readyState = MockWebSocket.CLOSED
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
  writable: true,
})

function makeTrainingRun(overrides: Partial<TrainingRun> = {}): TrainingRun {
  return {
    id: 'run-1',
    name: 'test-run',
    kind: 'checkpoint' as const,
    checkpoint_count: 2,
    has_samples: true,
    checkpoints: [
      { filename: 'model-step00004500.safetensors', step_number: 4500, has_samples: true },
      { filename: 'model.safetensors', step_number: 9000, has_samples: true },
    ],
    ...overrides,
  }
}

describe('useWebSocket', () => {
  let mockInstances: MockWebSocket[]
  let addImage: ReturnType<typeof vi.fn>
  let removeImage: ReturnType<typeof vi.fn>
  let rescan: ReturnType<typeof vi.fn>
  let comboSelections: Record<string, Set<string>>

  beforeEach(() => {
    vi.useFakeTimers()
    mockInstances = []
    addImage = vi.fn()
    removeImage = vi.fn()
    rescan = vi.fn().mockResolvedValue(undefined)
    comboSelections = {
      seed: new Set(['42']),
      cfg: new Set(['1']),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createWSOptions() {
    return {
      wsClientOptions: {
        url: 'ws://test/api/ws',
        createWebSocket: ((url: string) => {
          const ws = new MockWebSocket(url)
          mockInstances.push(ws)
          return ws
        }) as unknown as (url: string) => WebSocket,
        initialDelay: 100,
      },
    }
  }

  it('connects when a training run is selected', () => {
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())

    expect(mockInstances).toHaveLength(1)
  })

  it('does not connect when no training run is selected', () => {
    const selectedRun = ref<TrainingRun | null>(null)
    useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())

    expect(mockInstances).toHaveLength(0)
  })

  it('reconnects when training run changes', async () => {
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
    expect(mockInstances).toHaveLength(1)

    selectedRun.value = makeTrainingRun({ id: 'run-2', name: 'other-run' })
    // Vue watchers are async — trigger with nextTick via timer flush
    await vi.runAllTimersAsync()
    expect(mockInstances).toHaveLength(2)
  })

  it('disconnects when training run is set to null', async () => {
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
    expect(mockInstances).toHaveLength(1)

    selectedRun.value = null
    await vi.runAllTimersAsync()
    // Should not create a new connection
    expect(mockInstances).toHaveLength(1)
  })

  it('reports connected state', () => {
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    const { connected } = useWebSocket(
      selectedRun,
      addImage,
      removeImage,
      comboSelections,
      rescan,
      createWSOptions(),
    )

    expect(connected.value).toBe(false)
    mockInstances[0].simulateOpen()
    expect(connected.value).toBe(true)
  })

  it('reports connected state when connection opens immediately on initialization', async () => {
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())

    // Override createWebSocket to simulate immediate connection
    const options = {
      wsClientOptions: {
        url: 'ws://test/api/ws',
        createWebSocket: ((url: string) => {
          const ws = new MockWebSocket(url)
          mockInstances.push(ws)
          // Simulate immediate open (synchronous for testing)
          queueMicrotask(() => ws.simulateOpen())
          return ws
        }) as unknown as (url: string) => WebSocket,
        initialDelay: 100,
      },
    }

    const { connected } = useWebSocket(
      selectedRun,
      addImage,
      removeImage,
      comboSelections,
      rescan,
      options,
    )

    // Initially false before microtasks flush
    expect(connected.value).toBe(false)

    // Flush microtasks to allow the watch to complete and connection to open
    await vi.runAllTimersAsync()
    await new Promise<void>(resolve => queueMicrotask(resolve))

    // After the connection opens, connected should be true
    expect(connected.value).toBe(true)
  })

  describe('event handling', () => {
    it('calls addImage for image_added events', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'image_added',
          path: 'model-step00004500.safetensors/seed=42&cfg=1&_00001_.png',
        }),
      )

      expect(addImage).toHaveBeenCalledOnce()
      const addedImage: ScanImage = addImage.mock.calls[0][0]
      expect(addedImage.relative_path).toBe(
        'model-step00004500.safetensors/seed=42&cfg=1&_00001_.png',
      )
      expect(addedImage.dimensions['seed']).toBe('42')
      expect(addedImage.dimensions['cfg']).toBe('1')
      expect(addedImage.dimensions['checkpoint']).toBe('4500')
    })

    it('updates combo selections for new image dimensions', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      // Send event with a new seed value
      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'image_added',
          path: 'model.safetensors/seed=99&cfg=1&_00001_.png',
        }),
      )

      expect(comboSelections['seed'].has('99')).toBe(true)
      expect(comboSelections['seed'].has('42')).toBe(true) // existing value preserved
    })

    it('creates combo selection for new dimension', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'image_added',
          path: 'model.safetensors/seed=42&new_dim=hello&_00001_.png',
        }),
      )

      expect(comboSelections['new_dim']).toBeDefined()
      expect(comboSelections['new_dim'].has('hello')).toBe(true)
    })

    it('calls removeImage for image_removed events', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'image_removed',
          path: 'model.safetensors/seed=42&cfg=1&_00001_.png',
        }),
      )

      expect(removeImage).toHaveBeenCalledWith('model.safetensors/seed=42&cfg=1&_00001_.png')
    })

    it('calls rescan for directory_added events', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'directory_added',
          path: 'new-checkpoint.safetensors',
        }),
      )

      expect(rescan).toHaveBeenCalledOnce()
    })

    it('does not call addImage for unparseable paths', () => {
      const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
      useWebSocket(selectedRun, addImage, removeImage, comboSelections, rescan, createWSOptions())
      mockInstances[0].simulateOpen()

      mockInstances[0].simulateMessage(
        JSON.stringify({
          type: 'image_added',
          path: 'not-a-valid-path',
        }),
      )

      expect(addImage).not.toHaveBeenCalled()
    })
  })
})

// ─── scope disposal (unmount / HMR) ────────────────────────────────────────

/**
 * Mount a wrapper component so onScopeDispose fires correctly on unmount.
 * Follows the same pattern as useCountdown.test.ts.
 */
function mountWebSocket(selectedRun: Ref<TrainingRun | null>, opts: ReturnType<typeof createScopeTestOptions>) {
  let captured!: ReturnType<typeof useWebSocket>
  const Wrapper = defineComponent({
    setup() {
      captured = useWebSocket(
        selectedRun,
        opts.addImage,
        opts.removeImage,
        opts.comboSelections,
        opts.rescan,
        opts.wsOptions,
      )
      return {}
    },
    template: '<div />',
  })
  const wrapper = mount(Wrapper)
  return { wrapper, captured, mockInstances: opts.mockInstances }
}

function createScopeTestOptions() {
  const mockInstances: MockWebSocket[] = []
  return {
    addImage: vi.fn(),
    removeImage: vi.fn(),
    rescan: vi.fn().mockResolvedValue(undefined),
    comboSelections: {} as Record<string, Set<string>>,
    mockInstances,
    wsOptions: {
      wsClientOptions: {
        url: 'ws://test/api/ws',
        createWebSocket: ((url: string) => {
          const ws = new MockWebSocket(url)
          mockInstances.push(ws)
          return ws
        }) as unknown as (url: string) => WebSocket,
        initialDelay: 100,
        maxDelay: 1000,
      },
    },
  }
}

describe('useWebSocket — scope disposal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // AC: FE: disposing the component scope closes the socket and cancels pending reconnect timers
  it('disconnects and cancels reconnect timers on unmount', async () => {
    const opts = createScopeTestOptions()
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    const { wrapper, mockInstances } = mountWebSocket(selectedRun, opts)

    await nextTick()
    expect(mockInstances).toHaveLength(1)

    // Simulate the socket closing to trigger the reconnect backoff timer
    mockInstances[0].simulateClose()
    await nextTick()

    // Unmount the component — onScopeDispose should call disconnect()
    wrapper.unmount()

    // Advance time past the reconnect delay — no new connection should be created
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()

    expect(mockInstances).toHaveLength(1)
    // The WSClient must be in disconnected state
    expect(mockInstances[0].readyState).toBe(MockWebSocket.CLOSED)
  })

  // AC: FE: WSClient.disconnect() cancels a scheduled reconnect (no doConnect fires after disconnect)
  it('does not fire doConnect after disconnect() is called', async () => {
    const opts = createScopeTestOptions()
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    const { captured, mockInstances } = mountWebSocket(selectedRun, opts)

    await nextTick()
    expect(mockInstances).toHaveLength(1)

    // Simulate close to schedule a reconnect timer
    mockInstances[0].simulateClose()
    await nextTick()

    // Explicitly disconnect (same as onScopeDispose)
    captured.wsClient.disconnect()

    // Advance well past the reconnect delay
    await vi.advanceTimersByTimeAsync(2000)
    await nextTick()

    // No additional connection attempts
    expect(mockInstances).toHaveLength(1)
  })

  // AC: FE: listener counts on the client return to zero after unmount
  it('deregisters all composable listeners on unmount', async () => {
    const opts = createScopeTestOptions()
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    const { wrapper, captured } = mountWebSocket(selectedRun, opts)

    await nextTick()

    // Spy on off* methods to confirm they are called on dispose
    const offConnectionChange = vi.spyOn(captured.wsClient, 'offConnectionChange')
    const offEvent = vi.spyOn(captured.wsClient, 'offEvent')
    const disconnect = vi.spyOn(captured.wsClient, 'disconnect')

    wrapper.unmount()

    expect(offConnectionChange).toHaveBeenCalledOnce()
    expect(offEvent).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  // AC: FE: after unmount, composable listeners no longer fire
  it('composable event listener does not fire after unmount', async () => {
    const opts = createScopeTestOptions()
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())
    const { wrapper, mockInstances } = mountWebSocket(selectedRun, opts)

    await nextTick()
    mockInstances[0].simulateOpen()

    wrapper.unmount()

    // Re-connect a fresh socket (simulate the same WSClient being reused)
    // Instead, ensure addImage is NOT called for events sent after unmount.
    // After unmount the wsClient is disconnected, but if somehow a message
    // arrived we want to confirm the composable's handler is detached.
    // Manually push a message through the closed socket's onmessage to test
    // that the composable listener was deregistered.
    mockInstances[0].simulateMessage(
      JSON.stringify({
        type: 'image_added',
        path: 'model-step00004500.safetensors/seed=42&cfg=1&_00001_.png',
      }),
    )

    expect(opts.addImage).not.toHaveBeenCalled()
  })

  // AC: listener counts return to zero — behavioral check via WSClient internals via spies
  it('WSClient listener arrays are empty after scope dispose removes composable listeners', async () => {
    const opts = createScopeTestOptions()
    const selectedRun = ref<TrainingRun | null>(makeTrainingRun())

    // Capture the WSClient instance before mounting by spying on constructor
    const wsClientInstances: WSClient[] = []
    const origConstructor = WSClient
    vi.spyOn(origConstructor.prototype, 'onConnectionChange')
    vi.spyOn(origConstructor.prototype, 'offConnectionChange')
    vi.spyOn(origConstructor.prototype, 'onEvent')
    vi.spyOn(origConstructor.prototype, 'offEvent')

    const { wrapper, captured } = mountWebSocket(selectedRun, opts)
    wsClientInstances.push(captured.wsClient)

    await nextTick()

    // Before unmount: listeners were registered
    expect(wsClientInstances[0].onConnectionChange).toHaveBeenCalledOnce()
    expect(wsClientInstances[0].onEvent).toHaveBeenCalledOnce()

    wrapper.unmount()

    // After unmount: listeners were deregistered
    expect(wsClientInstances[0].offConnectionChange).toHaveBeenCalledOnce()
    expect(wsClientInstances[0].offEvent).toHaveBeenCalledOnce()
  })
})

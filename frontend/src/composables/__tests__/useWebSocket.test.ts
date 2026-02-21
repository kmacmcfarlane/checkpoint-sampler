import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useWebSocket } from '../useWebSocket'
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
    id: 1,
    name: 'test-run',
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

    selectedRun.value = makeTrainingRun({ id: 2, name: 'other-run' })
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

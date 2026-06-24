import { ref, watch, onScopeDispose, getCurrentScope, type Ref } from 'vue'
import { WSClient, type WSClientOptions } from '../api/wsClient'
import type { FSEventMessage, ScanImage, TrainingRun } from '../api/types'
import { parseImagePath } from './parseImagePath'

export interface UseWebSocketOptions {
  wsClientOptions?: WSClientOptions
}

/**
 * Composable that connects a WebSocket client to the app state.
 *
 * When a training run is selected, connects to the backend WebSocket endpoint.
 * Incoming filesystem events update the scan result incrementally:
 * - image_added: parse filename dimensions and add image to state
 * - image_removed: remove image from state
 * - directory_added: trigger a rescan of the training run
 *
 * On training run change, disconnects and reconnects.
 */
export function useWebSocket(
  selectedTrainingRun: Ref<TrainingRun | null>,
  addImage: (image: ScanImage) => void,
  removeImage: (relativePath: string) => void,
  comboSelections: Record<string, Set<string>>,
  rescan: () => Promise<void>,
  options: UseWebSocketOptions = {},
) {
  const connected = ref(false)
  const wsClient = new WSClient(options.wsClientOptions)

  const connectionChangeListener = (isConnected: boolean) => {
    connected.value = isConnected
  }
  const eventListener = (event: FSEventMessage) => {
    handleEvent(event)
  }

  wsClient.onConnectionChange(connectionChangeListener)
  wsClient.onEvent(eventListener)

  // Clean up listeners and close the socket when the owning scope is disposed
  // (component unmount, HMR hot-reload, etc.).  Without this, the WSClient
  // keeps its listener arrays alive and the exponential-backoff reconnect timer
  // keeps firing doConnect() against a dead consumer.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      wsClient.offConnectionChange(connectionChangeListener)
      wsClient.offEvent(eventListener)
      wsClient.disconnect()
    })
  }

  function handleEvent(event: FSEventMessage) {
    const run = selectedTrainingRun.value
    switch (event.type) {
      case 'image_added': {
        const image = parseImagePath(event.path, run?.checkpoints)
        if (image) {
          addImage(image)
          // Auto-select new dimension values in combo filters
          for (const [dimName, value] of Object.entries(image.dimensions)) {
            if (comboSelections[dimName]) {
              comboSelections[dimName].add(value)
            } else {
              comboSelections[dimName] = new Set([value])
            }
          }
        }
        break
      }
      case 'image_removed':
        removeImage(event.path)
        break
      case 'directory_added':
        rescan()
        break
    }
  }

  // Connect/disconnect when training run changes
  watch(
    selectedTrainingRun,
    (run) => {
      wsClient.disconnect()
      if (run) {
        wsClient.connect()
      }
    },
    { immediate: true },
  )

  return {
    connected,
    wsClient,
  }
}

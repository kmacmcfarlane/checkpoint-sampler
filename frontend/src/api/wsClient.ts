import type { FSEventMessage, JobProgressMessage } from './types'

/** Options for creating a WebSocket client. */
export interface WSClientOptions {
  /** Base URL for the WebSocket connection (default: derives from window.location). */
  url?: string
  /** Initial reconnect delay in ms (default: 1000). */
  initialDelay?: number
  /** Maximum reconnect delay in ms (default: 30000). */
  maxDelay?: number
  /** Backoff multiplier (default: 2). */
  backoffMultiplier?: number
  /** WebSocket constructor override for testing. */
  createWebSocket?: (url: string) => WebSocket
}

/** Listener callback for filesystem events. */
export type FSEventListener = (event: FSEventMessage) => void

/** Listener callback for job progress events. */
export type JobProgressListener = (event: JobProgressMessage) => void

/** Listener for connection state changes. */
export type ConnectionStateListener = (connected: boolean) => void

const VALID_FS_EVENT_TYPES: Set<string> = new Set<string>([
  'image_added',
  'image_removed',
  'directory_added',
])

/**
 * WebSocket client that connects to the backend /api/ws endpoint and
 * dispatches filesystem change events to registered listeners.
 *
 * Features:
 * - Auto-reconnects on disconnect with exponential backoff
 * - Resets backoff delay on successful connection
 * - Validates incoming messages before dispatching
 * - Supports connect/disconnect lifecycle
 */
export class WSClient {
  private readonly url: string
  private readonly initialDelay: number
  private readonly maxDelay: number
  private readonly backoffMultiplier: number
  private readonly createWebSocket: (url: string) => WebSocket

  private ws: WebSocket | null = null
  private currentDelay: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false
  private listeners: FSEventListener[] = []
  private jobListeners: JobProgressListener[] = []
  private connectionListeners: ConnectionStateListener[] = []

  constructor(options: WSClientOptions = {}) {
    this.url = options.url ?? buildDefaultWSUrl()
    this.initialDelay = options.initialDelay ?? 1000
    this.maxDelay = options.maxDelay ?? 30000
    this.backoffMultiplier = options.backoffMultiplier ?? 2
    this.createWebSocket = options.createWebSocket ?? ((url: string) => new WebSocket(url))
    this.currentDelay = this.initialDelay
  }

  /** Register a listener for filesystem events. */
  onEvent(listener: FSEventListener): void {
    this.listeners.push(listener)
  }

  /** Remove a filesystem event listener. */
  offEvent(listener: FSEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  /** Register a listener for job progress events. */
  onJobProgress(listener: JobProgressListener): void {
    this.jobListeners.push(listener)
  }

  /** Remove a job progress listener. */
  offJobProgress(listener: JobProgressListener): void {
    this.jobListeners = this.jobListeners.filter((l) => l !== listener)
  }

  /** Register a listener for connection state changes. */
  onConnectionChange(listener: ConnectionStateListener): void {
    this.connectionListeners.push(listener)
  }

  /** Remove a connection state listener. */
  offConnectionChange(listener: ConnectionStateListener): void {
    this.connectionListeners = this.connectionListeners.filter((l) => l !== listener)
  }

  /** Open the WebSocket connection. */
  connect(): void {
    this.intentionallyClosed = false
    this.doConnect()
  }

  /** Close the WebSocket connection and stop reconnecting. */
  disconnect(): void {
    this.intentionallyClosed = true
    this.clearReconnectTimer()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /** Whether the WebSocket is currently open. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private doConnect(): void {
    if (this.intentionallyClosed) return

    this.ws = this.createWebSocket(this.url)

    this.ws.onopen = () => {
      this.currentDelay = this.initialDelay
      this.notifyConnectionState(true)
    }

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data)
    }

    this.ws.onclose = () => {
      this.notifyConnectionState(false)
      this.ws = null
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }

    if (isValidFSEvent(parsed)) {
      const event = parsed as FSEventMessage
      for (const listener of this.listeners) {
        listener(event)
      }
    } else if (isValidJobProgressEvent(parsed)) {
      const event = parsed as JobProgressMessage
      for (const listener of this.jobListeners) {
        listener(event)
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, this.currentDelay)

    this.currentDelay = Math.min(this.currentDelay * this.backoffMultiplier, this.maxDelay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private notifyConnectionState(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected)
    }
  }
}

function isValidFSEvent(data: unknown): data is FSEventMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as FSEventMessage).type === 'string' &&
    VALID_FS_EVENT_TYPES.has((data as FSEventMessage).type) &&
    typeof (data as FSEventMessage).path === 'string'
  )
}

function isValidJobProgressEvent(data: unknown): data is JobProgressMessage {
  const msg = data as JobProgressMessage
  return (
    typeof data === 'object' &&
    data !== null &&
    msg.type === 'job_progress' &&
    typeof msg.job_id === 'string' &&
    typeof msg.status === 'string' &&
    typeof msg.total_items === 'number' &&
    typeof msg.completed_items === 'number' &&
    typeof msg.failed_items === 'number' &&
    typeof msg.pending_items === 'number' &&
    typeof msg.checkpoints_completed === 'number' &&
    typeof msg.total_checkpoints === 'number'
  )
}

function buildDefaultWSUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/ws`
}

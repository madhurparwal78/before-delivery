import type { ClientMessage, ServerMessage } from '../../shared/types.ts'
import { LINK_OFF_CLOSE } from '../../shared/types.ts'

const RECONNECT_MS = 1000

interface Handlers {
  onMessage(message: ServerMessage): void
  onUp(): void
  onDown(): void
}

/** The live connection of a room; reopens itself after a drop until the link is revoked or the room is left. */
export class Live {
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(private readonly gameId: string, private readonly handlers: Handlers) {
    this.open()
  }

  private open(): void {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/games/${this.gameId}/live`)
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage
      if (message.type === 'hello') this.handlers.onUp()
      this.handlers.onMessage(message)
    })
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket || this.stopped) return
      this.socket = null
      if (event.code === LINK_OFF_CLOSE) {
        this.stopped = true
        return
      }
      this.handlers.onDown()
      this.retry = setTimeout(() => this.open(), RECONNECT_MS)
    })
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message))
  }

  close(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.socket?.close()
  }
}

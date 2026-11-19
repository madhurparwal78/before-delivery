import { ensureSignedIn, whenQuiet } from './api'

// A server-sent event stream read with fetch, so Last-Event-ID and failures stay under our control.

type FeedHandlers = {
  onEvent: (seq: number, type: string, data: unknown) => void
  onResync: () => void
  onUp: () => void
  onDown: (code: string) => void
}

const RETRY_MS = 1500

async function errorCode(answer: Response): Promise<string> {
  try {
    return ((await answer.json()) as { error: { code: string } }).error.code
  } catch {
    return 'server_error'
  }
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export class Feed {
  private stopped = false
  private controller: AbortController | null = null

  constructor(private readonly path: string, private readonly lastSeq: () => number, private readonly handlers: FeedHandlers) {}

  start(): void {
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
  }

  private async run(): Promise<void> {
    // The first connection waits for the page to settle: the snapshot already on screen carries the revision to replay from.
    await whenQuiet()
    while (!this.stopped) {
      this.controller = new AbortController()
      try {
        const answer = await fetch(`${this.path}?last_event_id=${this.lastSeq()}`, {
          headers: { Accept: 'text/event-stream' }, credentials: 'same-origin', signal: this.controller.signal,
        })
        if (answer.status === 401) {
          await ensureSignedIn()
        } else if (!answer.ok || answer.body === null) {
          this.handlers.onDown(await errorCode(answer))
        } else {
          this.handlers.onUp()
          await this.read(answer.body)
        }
      } catch {
        if (!this.stopped) this.handlers.onDown('network')
      }
      if (!this.stopped) await pause(RETRY_MS)
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        this.dispatch(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
  }

  private dispatch(chunk: string): void {
    let id = ''
    let type = 'message'
    const data: string[] = []
    for (const line of chunk.split('\n')) {
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'id') id = text
      else if (field === 'event') type = text
      else if (field === 'data') data.push(text)
    }
    if (type === 'resync') {
      this.handlers.onResync()
      return
    }
    if (data.length === 0) return
    this.handlers.onEvent(Number(id), type, JSON.parse(data.join('\n')))
  }
}

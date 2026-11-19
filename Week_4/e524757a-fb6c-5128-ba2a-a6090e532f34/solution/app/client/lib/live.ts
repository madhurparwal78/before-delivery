/** The one same-origin server-sent events stream. Handlers run inside the message event itself. */
import type { LiveEventName, LiveEvents } from '../../shared/types'

export const tabId = crypto.randomUUID()

type Handler<K extends LiveEventName> = (data: LiveEvents[K]) => void

export interface Live {
  on<K extends LiveEventName>(name: K, handler: Handler<K>): void
  close(): void
}

const NAMES: LiveEventName[] = [
  'world', 'progress', 'position', 'restart', 'host_position', 'like', 'note', 'board',
  'safari_joined', 'safari_left', 'safari_ended', 'sighting', 'safari_photo',
]

const BEAT_MS = 250
const QUIET_BEATS = 3
const MAX_BEATS = 16

/** Real-time beats that the page's own clock cannot pause or move: a worker's timer. Null where workers are unavailable. */
function beats(onBeat: () => void): { stop(): void } | null {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${BEAT_MS})`], { type: 'text/javascript' }))
    const worker = new Worker(url)
    worker.onmessage = onBeat
    return { stop: () => { worker.terminate(); URL.revokeObjectURL(url) } }
  } catch {
    return null
  }
}

/** `hall` subscribes this page to the likes of one public hall. The stream opens once the page has gone quiet after loading
 *  (a connection held open from the start keeps a page from ever settling) and asks the server for what it missed. */
export function openLive(options: { hall?: string } = {}): Live {
  const handlers = new Map<string, Handler<never>[]>()
  let source: EventSource | null = null
  let closed = false
  let ticker: { stop(): void } | null = null

  const connect = (waited: number): void => {
    ticker?.stop()
    ticker = null
    if (closed) return
    const query = new URLSearchParams({ link: crypto.randomUUID(), age: String(waited * BEAT_MS + 150) })
    if (options.hall) query.set('hall', options.hall)
    source = new EventSource(`/api/live?${query}`)
    for (const name of NAMES) {
      source.addEventListener(name, (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data)
        for (const handler of handlers.get(name) ?? []) (handler as (d: unknown) => void)(data)
      })
    }
  }

  let beat = 0
  let seen = -1
  let still = 0
  ticker = beats(() => {
    beat += 1
    const count = performance.getEntriesByType('resource').length
    still = count === seen && document.readyState === 'complete' ? still + 1 : 0
    seen = count
    if (still >= QUIET_BEATS || beat >= MAX_BEATS) connect(beat)
  })
  if (!ticker) connect(0)

  return {
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler as Handler<never>)
      handlers.set(name, list)
    },
    close: () => {
      closed = true
      ticker?.stop()
      source?.close()
    },
  }
}

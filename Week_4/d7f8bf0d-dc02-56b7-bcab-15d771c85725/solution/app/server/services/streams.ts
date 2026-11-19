import type { ServerResponse } from 'node:http'
import type { Valkey } from './valkey'

// Each instance reads the Valkey Streams with its own XREAD cursor and forwards every entry to its browsers.
// No browser event comes from any other path.

const REPLAY_BATCH = 500
const HEARTBEAT_MS = 10_000

interface Subscriber {
  res: ServerResponse
  lastSent: number
  buffer: Array<{ seq: number; type: string; payload: string }> | null
}

function message(seq: number, type: string, payload: string): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${payload}\n\n`
}

export class StreamHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  private readonly cursors = new Map<string, number>()
  private running = false

  constructor(private readonly valkey: Valkey) {
    valkey.onChange(up => {
      if (!up) this.closeAll()
    })
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
    setInterval(() => {
      for (const set of this.subscribers.values()) for (const subscriber of set) subscriber.res.write(': keep-alive\n\n')
    }, HEARTBEAT_MS)
  }

  private closeAll(): void {
    for (const set of this.subscribers.values()) for (const subscriber of set) subscriber.res.end()
    this.subscribers.clear()
    this.cursors.clear()
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.cursors.size === 0 || !this.valkey.up) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }
      try {
        for (const { stream, entries } of await this.valkey.read(this.cursors)) {
          for (const entry of entries) {
            this.cursors.set(stream, Math.max(this.cursors.get(stream) ?? 0, entry.seq))
            for (const subscriber of this.subscribers.get(stream) ?? []) this.deliver(subscriber, entry)
          }
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  }

  private deliver(subscriber: Subscriber, entry: { seq: number; type: string; payload: string }): void {
    if (subscriber.buffer !== null) {
      subscriber.buffer.push(entry)
      return
    }
    if (entry.seq <= subscriber.lastSent) return
    subscriber.lastSent = entry.seq
    subscriber.res.write(message(entry.seq, entry.type, entry.payload))
  }

  // Replays what the browser missed (or sends one resync when it has aged out), then carries on live.
  async subscribe(stream: string, res: ServerResponse, lastEventId: number | null, committedSeq: number): Promise<void> {
    // Without a last event id the browser starts live: what was committed before it asked is not replayed.
    const subscriber: Subscriber = { res, lastSent: lastEventId ?? committedSeq, buffer: [] }
    const set = this.subscribers.get(stream) ?? new Set<Subscriber>()
    this.subscribers.set(stream, set)
    set.add(subscriber)
    res.on('close', () => {
      set.delete(subscriber)
      if (set.size === 0) {
        this.subscribers.delete(stream)
        this.cursors.delete(stream)
      }
    })
    if (!this.cursors.has(stream)) this.cursors.set(stream, await this.valkey.newest(stream))
    if (lastEventId !== null) {
      const oldest = await this.valkey.oldest(stream)
      const newest = await this.valkey.newest(stream)
      if (newest > lastEventId && (oldest === null || oldest > lastEventId + 1)) {
        res.write(`event: resync\ndata: ${JSON.stringify({ reason: 'replay_aged_out' })}\n\n`)
        subscriber.lastSent = newest
      } else {
        for (let from = lastEventId; ;) {
          const batch = await this.valkey.after(stream, from, REPLAY_BATCH)
          for (const entry of batch) {
            from = entry.seq
            subscriber.lastSent = entry.seq
            res.write(message(entry.seq, entry.type, entry.payload))
          }
          if (batch.length < REPLAY_BATCH) break
        }
      }
    }
    const held = subscriber.buffer ?? []
    subscriber.buffer = null
    for (const entry of held) this.deliver(subscriber, entry)
  }
}

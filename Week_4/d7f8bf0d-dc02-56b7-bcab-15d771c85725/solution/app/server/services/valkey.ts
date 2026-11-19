import { Redis, type RedisOptions } from 'ioredis'

// Valkey for live delivery between instances: Streams for events, a key per session for the tick lease.

const LEASE_SCRIPT = `
local holder = redis.call('get', KEYS[1])
if holder == false then
  redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
elseif holder == ARGV[1] then
  redis.call('pexpire', KEYS[1], ARGV[2])
  return 1
end
return 0`

const LEASE_MS = 3000
const STREAM_KEEP = 2000

export const sessionStream = (sessionId: string): string => `gandyboard:session:${sessionId}:events`
export const layoutStream = (layoutId: string): string => `gandyboard:layout:${layoutId}:events`
const leaseKey = (sessionId: string): string => `gandyboard:session:${sessionId}:tick-lease`

interface StreamEntry { seq: number; type: string; payload: string }

function options(): RedisOptions {
  return {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    commandTimeout: 2500,
    retryStrategy: attempt => Math.min(attempt * 250, 2000),
    reconnectOnError: () => false,
  }
}

function entriesOf(raw: Array<[string, string[]]>): StreamEntry[] {
  return raw.map(([id, fields]) => {
    const record: Record<string, string> = {}
    for (let i = 0; i < fields.length; i += 2) record[fields[i]] = fields[i + 1]
    return { seq: Number(id.split('-')[0]), type: record.type, payload: record.payload }
  })
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export class Valkey {
  private readonly commands: Redis
  private readonly reader: Redis
  private listeners: Array<(up: boolean) => void> = []
  up = false
  // True once the first probe has answered, so a cold start is not mistaken for an outage.
  settled = false
  private failures = 0

  constructor(url: string, private readonly instanceId: string) {
    this.commands = new Redis(url, options())
    this.reader = new Redis(url, options())
    this.commands.on('error', () => undefined)
    this.reader.on('error', () => undefined)
    this.commands.defineCommand('holdLease', { numberOfKeys: 1, lua: LEASE_SCRIPT })
  }

  onChange(listener: (up: boolean) => void): void {
    this.listeners.push(listener)
  }

  private set(up: boolean): void {
    if (up === this.up) return
    this.up = up
    for (const listener of this.listeners) listener(up)
  }

  // Probes every half second; two failures in a row mean down, one answer means up.
  watch(): void {
    const probe = async (): Promise<void> => {
      try {
        if (this.commands.status === 'wait') await Promise.race([this.commands.connect(), delay(2000).then(() => Promise.reject(new Error('no connection')))])
        if ((await this.commands.ping()) !== 'PONG') throw new Error('no pong')
        this.failures = 0
        this.set(true)
      } catch {
        this.failures += 1
        if (this.failures >= 2 || !this.settled) this.set(false)
      }
      this.settled = true
      setTimeout(() => void probe(), 500)
    }
    void probe()
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.commands.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async holdLease(sessionId: string): Promise<boolean> {
    const result = await (this.commands as unknown as { holdLease(key: string, holder: string, ms: number): Promise<number> })
      .holdLease(leaseKey(sessionId), this.instanceId, LEASE_MS)
    return result === 1
  }

  async leaseHolder(sessionId: string): Promise<string | null> {
    return this.commands.get(leaseKey(sessionId))
  }

  // Idempotent: an entry that is already on the stream counts as published.
  async publish(stream: string, seq: number, type: string, payload: string): Promise<void> {
    try {
      await this.commands.xadd(stream, 'MAXLEN', '~', STREAM_KEEP, `${seq}-0`, 'type', type, 'payload', payload)
    } catch (error) {
      if (!(error instanceof Error) || !/equal or smaller/.test(error.message)) throw error
    }
  }

  async newest(stream: string): Promise<number> {
    const entries = await this.commands.xrevrange(stream, '+', '-', 'COUNT', 1)
    return entries.length === 0 ? 0 : Number(entries[0][0].split('-')[0])
  }

  async oldest(stream: string): Promise<number | null> {
    const entries = await this.commands.xrange(stream, '-', '+', 'COUNT', 1)
    return entries.length === 0 ? null : Number(entries[0][0].split('-')[0])
  }

  async after(stream: string, seq: number, count: number): Promise<StreamEntry[]> {
    return entriesOf(await this.commands.xrange(stream, `(${seq}-0`, '+', 'COUNT', count) as Array<[string, string[]]>)
  }

  async read(cursors: Map<string, number>): Promise<Array<{ stream: string; entries: StreamEntry[] }>> {
    const streams = [...cursors.keys()]
    if (streams.length === 0) return []
    if (this.reader.status === 'wait') this.reader.connect().catch(() => undefined)
    const answer = await this.reader.xread('BLOCK', 300, 'STREAMS', ...streams, ...streams.map(stream => `${cursors.get(stream)}-0`)) as
      Array<[string, Array<[string, string[]]>]> | null
    return (answer ?? []).map(([stream, raw]) => ({ stream, entries: entriesOf(raw) }))
  }
}

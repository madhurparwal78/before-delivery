import type { ServerResponse } from 'node:http'
import pg from 'pg'
import { config } from './config'
import { pool } from './db'

export interface Target {
  visitor?: string
  user?: number | null
}

export interface LiveEvent {
  name: 'clock' | 'availability' | 'quote.changed' | 'hold.expired' | 'account.changed'
  data: Record<string, unknown>
  target: Target | null
}

interface Stream {
  res: ServerResponse
  visitor: string
  user: number | null
}

const CHANNEL = 'kip_events'
const streams = new Set<Stream>()
let listening = false

const frame = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

function matches(stream: Stream, target: Target | null): boolean {
  if (!target) return true
  return (target.visitor !== undefined && stream.visitor === target.visitor) || (target.user != null && stream.user === target.user)
}

function dispatch(event: LiveEvent): void {
  for (const stream of streams) if (matches(stream, event.target)) stream.res.write(frame(event.name, event.data))
}

export async function emit(event: LiveEvent): Promise<void> {
  if (!listening) return dispatch(event)
  try {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)])
  } catch {
    dispatch(event)
  }
}

export function startListening(): void {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl })
    client.on('error', () => undefined)
    client.on('end', () => {
      listening = false
      setTimeout(() => void connect(), 1000)
    })
    client.on('notification', (message) => {
      if (message.payload) dispatch(JSON.parse(message.payload) as LiveEvent)
    })
    try {
      await client.connect()
      await client.query(`LISTEN ${CHANNEL}`)
      listening = true
    } catch {
      client.end().catch(() => undefined)
    }
  }
  void connect()
}

export function open(res: ServerResponse, visitor: string, user: number | null, heartbeatMs: number, initial: LiveEvent[]): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const stream: Stream = { res, visitor, user }
  streams.add(stream)
  for (const event of initial) res.write(frame(event.name, event.data))
  const beat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs)
  res.on('close', () => {
    clearInterval(beat)
    streams.delete(stream)
  })
}

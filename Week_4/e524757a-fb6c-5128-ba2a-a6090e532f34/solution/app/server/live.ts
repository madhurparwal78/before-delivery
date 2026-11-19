/** Live events over server-sent events. Events travel through Postgres NOTIFY so every instance fans them out to its own
 *  streams; a stream holds no database connection and no transaction. */
import pg from 'pg'
import { config } from './config'
import { type Db, pool } from './db'
import { type Context, route } from './http'
import { readClocks, readTick, worldEvent } from './world'
import type { LiveEventName, LiveEvents } from '../shared/types'

const CHANNEL = 'hushfoot_live'

interface Audience {
  players?: readonly string[]
  world?: string
  /** The rangers of one world. */
  rangers?: string
  /** Pages with this public hall open. */
  hall?: string
}

interface Envelope { audience: Audience; name: LiveEventName | 'clock'; data: unknown }

interface Stream { res: Context['res']; playerId: string; worldId: string; ranger: boolean; hall: string | undefined }

const streams = new Set<Stream>()

/** A page opens its stream a moment after it loads (see `client/lib/live.ts`) and asks for what came in meanwhile. */
const REPLAY_MS = 10_000
const recent: { at: number; envelope: Envelope }[] = []
const replayed = new Set<string>()

const lastTick = new Map<string, number>()

export async function publish<K extends LiveEventName>(db: Db, audience: Audience, name: K, data: LiveEvents[K]): Promise<void> {
  const envelope: Envelope = { audience, name, data }
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(envelope)])
}

/** Every open page of the world re-reads its clock at once (a grading clock was moved). */
export async function announceClock(): Promise<void> {
  const envelope: Envelope = { audience: {}, name: 'clock', data: null }
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(envelope)])
}

function write(stream: Stream, name: string, data: unknown): void {
  if (!stream.res.writableEnded) stream.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

function reaches(audience: Audience, stream: Stream): boolean {
  return (
    (audience.players?.includes(stream.playerId) ?? false) ||
    audience.world === stream.worldId ||
    (audience.rangers === stream.worldId && stream.ranger) ||
    (audience.hall !== undefined && audience.hall === stream.hall)
  )
}

let ticking = false

/** Reads the clock of every world with an open stream here and pushes the creatures when its tick moved. */
async function tickWorlds(): Promise<void> {
  if (ticking || streams.size === 0) return
  ticking = true
  try {
    const worldIds = [...new Set([...streams].map((s) => s.worldId))]
    for (const clock of await readClocks(pool, worldIds)) {
      if (lastTick.get(clock.id) === clock.tick) continue
      lastTick.set(clock.id, clock.tick)
      const event = worldEvent(clock.tick)
      for (const stream of streams) if (stream.worldId === clock.id) write(stream, 'world', event)
    }
  } finally {
    ticking = false
  }
}

function dispatch(payload: string): void {
  let envelope: Envelope
  try {
    envelope = JSON.parse(payload) as Envelope
  } catch {
    return
  }
  if (envelope.name === 'clock') {
    void tickWorlds().catch(() => undefined)
    return
  }
  const now = Date.now()
  recent.push({ at: now, envelope })
  while (recent[0] && recent[0].at < now - REPLAY_MS) recent.shift()
  for (const stream of streams) if (reaches(envelope.audience, stream)) write(stream, envelope.name, envelope.data)
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 })
  const again = (): void => { setTimeout(() => void listen(), 1000) }
  client.on('notification', (message) => { if (message.payload) dispatch(message.payload) })
  client.on('error', () => client.end().catch(() => undefined))
  client.on('end', again)
  try {
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
  } catch {
    client.removeAllListeners('end')
    await client.end().catch(() => undefined)
    again()
  }
}

/** The seated guest's seat stays held while any of their streams is open, and starts its countdown when the last closes. */
const seatSeen = (playerIds: readonly string[]): Promise<unknown> =>
  pool.query(`UPDATE safaris SET guest_seen_at = now() WHERE status = 'joined' AND guest_id = ANY($1)`, [playerIds])

async function pulse(): Promise<void> {
  for (const stream of streams) if (!stream.res.writableEnded) stream.res.write(': ping\n\n')
  await seatSeen([...new Set([...streams].map((s) => s.playerId))])
  await tickWorlds()
}

export function startLive(): void {
  void listen()
  setInterval(() => void pulse().catch(() => undefined), config.liveIntervalMs)
}

async function openStream(context: Context): Promise<undefined> {
  const player = context.player as NonNullable<Context['player']>
  const { res } = context
  const stream: Stream = { res, playerId: player.id, worldId: player.world_id, ranger: player.ranger, hall: context.url.searchParams.get('hall') ?? undefined }
  let closed = false
  res.on('close', () => {
    closed = true
    streams.delete(stream)
    if (![...streams].some((s) => s.playerId === stream.playerId)) void seatSeen([stream.playerId]).catch(() => undefined)
  })
  const tick = await readTick(pool, player.world_id)
  if (closed) return undefined
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.socket?.setNoDelay(true)
  res.write('retry: 1000\n\n')
  streams.add(stream)
  write(stream, 'world', worldEvent(tick))
  lastTick.set(player.world_id, tick)
  // The first connection of a page gets what was published since the page asked; the browser's own reconnects (same `link`) do not.
  const link = context.url.searchParams.get('link') ?? ''
  const age = Math.min(Number(context.url.searchParams.get('age')) || 0, REPLAY_MS)
  if (link !== '' && age > 0 && !replayed.has(link)) {
    for (const { at, envelope } of recent) {
      if (at >= Date.now() - age && envelope.name !== 'clock' && reaches(envelope.audience, stream)) write(stream, envelope.name, envelope.data)
    }
  }
  if (link !== '') {
    if (replayed.size > 5000) replayed.clear()
    replayed.add(link)
  }
  void seatSeen([player.id]).catch(() => undefined)
  return undefined
}

route('GET', '/api/live', 'required', openStream)

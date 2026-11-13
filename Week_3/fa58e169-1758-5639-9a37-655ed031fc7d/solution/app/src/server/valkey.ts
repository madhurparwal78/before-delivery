import { Redis } from 'ioredis'
import { config } from './config.ts'

const OPTIONS = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 1000,
  commandTimeout: 800,
  retryStrategy: (attempt: number) => Math.min(attempt * 250, 2000),
}

const commands = new Redis(config.valkeyUrl, OPTIONS)
const subscriber = new Redis(config.valkeyUrl, { ...OPTIONS, commandTimeout: undefined })

type Listener = (live: boolean) => void
const listeners: Listener[] = []
let reported = false

export function isLive(): boolean {
  return commands.status === 'ready' && subscriber.status === 'ready'
}

function report(): void {
  const live = isLive()
  if (live === reported) return
  reported = live
  for (const listener of listeners) listener(live)
}

export function onLiveChange(listener: Listener): void {
  listeners.push(listener)
}

for (const client of [commands, subscriber]) {
  client.on('error', () => undefined)
  for (const event of ['ready', 'close', 'end', 'reconnecting']) client.on(event, report)
}

export async function startValkey(onMessage: (patternId: string, payload: string) => void): Promise<void> {
  subscriber.on('pmessage', (_pattern, channel, payload) => onMessage(channel.slice('pattern:'.length), payload))
  subscriber.on('ready', () => { subscriber.psubscribe('pattern:*').catch(() => undefined) })
  await Promise.allSettled([commands.connect(), subscriber.connect()])
}

export async function publish(patternId: string, payload: unknown): Promise<void> {
  try {
    await commands.publish(`pattern:${patternId}`, JSON.stringify(payload))
  } catch {
    // live updates are best effort: saved work never waits on Valkey
  }
}

export async function presenceAnnounce(patternId: string, userId: string, name: string): Promise<void> {
  const key = `presence:${patternId}`
  try {
    await commands.hset(key, userId, name)
    await commands.call('HEXPIRE', key, config.limits.presenceTtlSeconds, 'FIELDS', 1, userId)
  } catch {
    // presence is best effort
  }
}

export async function presenceLeave(patternId: string, userId: string): Promise<void> {
  try {
    await commands.hdel(`presence:${patternId}`, userId)
  } catch {
    // presence is best effort
  }
}

export async function presenceList(patternId: string): Promise<{ id: string; name: string }[] | null> {
  try {
    const all = await commands.hgetall(`presence:${patternId}`)
    return Object.entries(all).map(([id, name]) => ({ id, name }))
  } catch {
    return null
  }
}

const STEP = `
local cur = redis.call('GET', KEYS[1])
if (not cur) or tonumber(cur) ~= tonumber(ARGV[4]) then cur = ARGV[4] end
cur = tonumber(cur)
if cur == tonumber(ARGV[1]) then
  local nxt = cur + tonumber(ARGV[2])
  if nxt >= 1 and nxt <= tonumber(ARGV[3]) then
    redis.call('SET', KEYS[1], nxt)
    return nxt
  end
end
redis.call('SET', KEYS[1], cur)
return cur
`

/** Compare-and-set of a tester's row; null when Valkey cannot answer. */
export async function counterStep(patternId: string, userId: string, from: number, step: number, total: number, stored: number): Promise<number | null> {
  try {
    const row = await commands.eval(STEP, 1, `counter:${patternId}:${userId}`, from, step, total, stored)
    return Number(row)
  } catch {
    return null
  }
}

export async function counterSet(patternId: string, userId: string, row: number): Promise<void> {
  try {
    await commands.set(`counter:${patternId}:${userId}`, String(row))
  } catch {
    // Postgres holds the row; Valkey is loaded from it when the key is missing
  }
}

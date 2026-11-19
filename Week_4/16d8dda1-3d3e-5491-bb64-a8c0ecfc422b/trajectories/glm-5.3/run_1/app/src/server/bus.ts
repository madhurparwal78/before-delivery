import { Redis } from 'ioredis'
import { config } from './config.js'

export const PAUSED_503 = 'Live updates are paused. Try again in a moment.'
export const BUS_CHANNEL = 'sh:events'

let outagesForced = false

export function setBusOutage(down: boolean): void {
  outagesForced = down
  if (down) {
    publisher.disconnect()
    commands.disconnect()
    subscriber.disconnect()
  } else {
    reconnectAll()
  }
}

const connectionOptions = (): import('ioredis').RedisOptions => ({
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  retryStrategy: (times: number): number => Math.min(times * 200, 2000),
  lazyConnect: false
})

export const commands = new Redis(config.valkeyUrl, connectionOptions())
export const publisher = new Redis(config.valkeyUrl, connectionOptions())

const localListeners = new Set<(channel: string, message: string) => void>()

type StringMap = Record<string, string>

function toMap(values: StringMap): StringMap {
  return { ...values }
}

export const subscriber = new Redis(config.valkeyUrl, connectionOptions())
subscriber.on('message', (channel: string, message: string) => {
  for (const listener of localListeners) listener(channel, message)
})
void subscriber.subscribe(BUS_CHANNEL).catch(() => undefined)

export function onBusMessage(listener: (channel: string, message: string) => void): void {
  localListeners.add(listener)
}

export function busDown(): boolean {
  return outagesForced || commands.status !== 'ready'
}

export class BusError extends Error {}

async function call<T>(work: () => Promise<T>): Promise<T> {
  if (busDown()) throw new BusError(PAUSED_503)
  try {
    return await work()
  } catch (error) {
    if (error instanceof BusError) throw error
    throw new BusError(PAUSED_503)
  }
}

function reconnectAll(): void {
  for (const connection of [commands, publisher, subscriber]) {
    if (connection.status !== 'ready' && connection.status !== 'connecting') {
      connection.connect().catch(() => undefined)
    }
  }
}

commands.on('ready', reconnectAll)

export const seats = {
  key: (sessionId: string) => `sh:${sessionId}:seats`,
  all: async (sessionId: string): Promise<Record<string, string>> =>
    call(async () => toMap(await commands.hgetall(seats.key(sessionId)))),
  claim: async (sessionId: string, seatId: string, learnerId: string): Promise<boolean> =>
    call(async () => {
      // The decision is made atomically in Valkey: the claim the server
      // receives first wins, exactly one winner.
      const winner = await commands.eval(
        `local occupant = redis.call('HGET', KEYS[1], ARGV[1])
         if occupant and occupant ~= ARGV[2] then return 0 end
         local previous = redis.call('HGET', KEYS[2], ARGV[2])
         if previous and previous ~= ARGV[1] then redis.call('HSET', KEYS[1], previous, '') end
         redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
         redis.call('HSET', KEYS[2], ARGV[2], ARGV[1])
         return 1`,
        2,
        seats.key(sessionId),
        seatOf.key(sessionId),
        seatId,
        learnerId
      )
      return winner === 1
    }),
  clearSeat: async (sessionId: string, seatId: string): Promise<void> =>
    call(async () => {
      await commands.hdel(seats.key(sessionId), seatId)
    }),
  seatOf: async (sessionId: string, learnerId: string): Promise<string | null> =>
    call(async () => {
      const value = await commands.hget(seatOf.key(sessionId), learnerId)
      return value === null || value === '' ? null : value
    })
}

export const seatOf = {
  key: (sessionId: string) => `sh:${sessionId}:seat-of`,
  all: async (sessionId: string): Promise<Record<string, string>> =>
    call(async () => toMap(await commands.hgetall(seatOf.key(sessionId)))),
  clear: async (sessionId: string, learnerId: string): Promise<void> =>
    call(async () => {
      await commands.hdel(seatOf.key(sessionId), learnerId)
    })
}

export const slide = {
  key: (sessionId: string) => `sh:${sessionId}:slide`,
  get: async (sessionId: string): Promise<number | null> =>
    call(async () => {
      const value = await commands.get(slide.key(sessionId))
      return value === null ? null : Number(value)
    }),
  set: async (sessionId: string, value: number): Promise<void> =>
    call(async () => {
      await commands.set(slide.key(sessionId), String(value))
    })
}

export const hands = {
  key: (sessionId: string) => `sh:${sessionId}:hands`,
  all: async (sessionId: string): Promise<string[]> =>
    call(async () => commands.lrange(hands.key(sessionId), 0, -1)),
  raise: async (sessionId: string, learnerId: string): Promise<void> =>
    call(async () => {
      await commands.lrem(hands.key(sessionId), 0, learnerId)
      await commands.rpush(hands.key(sessionId), learnerId)
    }),
  lower: async (sessionId: string, learnerId: string): Promise<void> =>
    call(async () => {
      await commands.lrem(hands.key(sessionId), 0, learnerId)
    }),
  take: async (sessionId: string): Promise<string | null> =>
    call(async () => {
      const first = await commands.lpop(hands.key(sessionId))
      return first === '' || first === null ? null : first
    })
}

export const pollCounts = {
  key: (sessionId: string, pollId: string) => `sh:${sessionId}:poll:${pollId}`,
  get: async (sessionId: string, pollId: string): Promise<Record<string, string>> =>
    call(async () => toMap(await commands.hgetall(pollCounts.key(sessionId, pollId)))),
  init: async (sessionId: string, pollId: string, optionCount: number): Promise<void> =>
    call(async () => {
      const key = pollCounts.key(sessionId, pollId)
      await commands.del(key)
      const fields: string[] = []
      for (let option = 1; option <= optionCount; option++) {
        fields.push(String(option), '0')
      }
      if (fields.length > 0) await commands.hset(key, ...fields)
    }),
  set: async (sessionId: string, pollId: string, counts: StringMap): Promise<void> =>
    call(async () => {
      await commands.hset(pollCounts.key(sessionId, pollId), counts)
    })
}

export const flags = {
  key: (sessionId: string) => `sh:${sessionId}:flags`,
  get: async (sessionId: string): Promise<{ locked: boolean; spotlight: string | null }> =>
    call(async () => {
      const values = await commands.hgetall(flags.key(sessionId))
      return {
        locked: values['locked'] === '1',
        spotlight: values['spotlight'] || null
      }
    }),
  set: async (sessionId: string, field: 'locked' | 'spotlight', value: string): Promise<void> =>
    call(async () => {
      await commands.hset(flags.key(sessionId), field, value)
    })
}

export const breakout = {
  key: (sessionId: string) => `sh:${sessionId}:breakout`,
  membersKey: (sessionId: string) => `sh:${sessionId}:breakout:members`,
  read: async (sessionId: string): Promise<{ deadline: string | null; tables: string | null }> =>
    call(async () => {
      const values = await commands.hgetall(breakout.key(sessionId))
      return {
        deadline: values['deadline'] || null,
        tables: values['tables'] || null
      }
    }),
  start: async (sessionId: string, deadline: string, tables: string, members: Record<string, string>): Promise<void> =>
    call(async () => {
      await commands.hset(breakout.key(sessionId), { deadline, tables })
      await commands.del(breakout.membersKey(sessionId))
      if (Object.keys(members).length > 0) {
        await commands.hset(breakout.membersKey(sessionId), members)
      }
    }),
  extend: async (sessionId: string, deadline: string): Promise<void> =>
    call(async () => {
      await commands.hset(breakout.key(sessionId), 'deadline', deadline)
    }),
  members: async (sessionId: string): Promise<Record<string, string>> =>
    call(async () => toMap(await commands.hgetall(breakout.membersKey(sessionId)))),
  end: async (sessionId: string): Promise<void> =>
    call(async () => {
      await commands.del(breakout.key(sessionId), breakout.membersKey(sessionId))
    })
}

export const online = {
  key: (sessionId: string) => `sh:${sessionId}:online`,
  add: async (sessionId: string, learnerId: string): Promise<void> =>
    call(async () => {
      await commands.sadd(online.key(sessionId), learnerId)
    }),
  remove: async (sessionId: string, learnerId: string): Promise<void> =>
    call(async () => {
      await commands.srem(online.key(sessionId), learnerId)
    }),
  all: async (sessionId: string): Promise<string[]> =>
    call(async () => commands.smembers(online.key(sessionId)))
}

export function heartbeatKey(sessionId: string, instance: string): string {
  return `sh:${sessionId}:heartbeat:${instance}`
}

export async function beat(sessionId: string): Promise<void> {
  await call(async () => {
    await commands.set(heartbeatKey(sessionId, config.instanceName), '1', 'EX', 30)
  })
}

export async function removeSessionKeys(sessionId: string): Promise<void> {
  await call(async () => {
    await commands.del(
      seats.key(sessionId),
      seatOf.key(sessionId),
      slide.key(sessionId),
      hands.key(sessionId),
      flags.key(sessionId),
      breakout.key(sessionId),
      breakout.membersKey(sessionId),
      online.key(sessionId)
    )
  })
}

export interface LiveEvent {
  sessionId: string
  kind: string
}

export async function publish(event: LiveEvent): Promise<void> {
  if (busDown()) return
  try {
    await publisher.publish(BUS_CHANNEL, JSON.stringify(event))
  } catch {
    // Pages on other instances keep their last snapshot; this instance will
    // show the paused banner until the bus returns.
  }
}

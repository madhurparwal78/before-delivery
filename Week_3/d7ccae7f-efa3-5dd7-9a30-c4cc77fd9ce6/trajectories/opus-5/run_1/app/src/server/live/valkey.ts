import { Redis } from 'ioredis';
import { config } from '../config.js';
import type { RoomEvent } from '../../shared/protocol.js';

const ROOM_KEY_TTL_SECONDS = 3600;
const REPLAY_BUFFER_LIMIT = 500;
const PROBE_INTERVAL_MS = 5_000;

function connect(): Redis {
  return new Redis(config.valkeyUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => PROBE_INTERVAL_MS,
    reconnectOnError: () => true,
  });
}

const commands = connect();
const subscriber = connect();

for (const connection of [commands, subscriber]) {
  connection.on('error', () => {
    // The retry strategy reconnects; liveness is reported by the probe below.
  });
  void connection.connect().catch(() => undefined);
}

const roomHandlers = new Map<string, Set<(event: RoomEvent) => void>>();
const downListeners = new Set<() => void>();
const upListeners = new Set<() => Promise<void> | void>();
let live = false;

subscriber.on('message', (channel: string, payload: string) => {
  const roomId = channel.slice('lastbell:room:'.length, channel.lastIndexOf(':'));
  const handlers = roomHandlers.get(roomId);
  if (!handlers) return;
  const event = JSON.parse(payload) as RoomEvent;
  for (const handler of handlers) handler(event);
});

subscriber.on('ready', () => {
  for (const roomId of roomHandlers.keys()) {
    void subscriber.subscribe(channelOf(roomId)).catch(() => undefined);
  }
});

function channelOf(roomId: string): string {
  return `lastbell:room:${roomId}:channel`;
}

function leaderboardKey(roomId: string): string {
  return `lastbell:room:${roomId}:leaderboard`;
}

function clientsKey(roomId: string): string {
  return `lastbell:room:${roomId}:clients`;
}

function eventsKey(roomId: string): string {
  return `lastbell:room:${roomId}:events`;
}

export function liveIsUp(): boolean {
  return live;
}

export function onLiveDown(listener: () => void): void {
  downListeners.add(listener);
}

export function onLiveUp(listener: () => Promise<void> | void): void {
  upListeners.add(listener);
}

export function startLiveProbe(): void {
  const probe = async (): Promise<void> => {
    let reachable = false;
    try {
      reachable = (await commands.ping()) === 'PONG';
    } catch {
      reachable = false;
    }
    if (reachable === live) return;
    live = reachable;
    if (reachable) {
      for (const listener of upListeners) await listener();
    } else {
      for (const listener of downListeners) listener();
    }
  };
  void probe();
  setInterval(() => void probe(), PROBE_INTERVAL_MS).unref();
}

export async function publishEvent(roomId: string, event: RoomEvent): Promise<void> {
  const payload = JSON.stringify(event);
  try {
    await commands
      .multi()
      .rpush(eventsKey(roomId), payload)
      .ltrim(eventsKey(roomId), -REPLAY_BUFFER_LIMIT, -1)
      .publish(channelOf(roomId), payload)
      .exec();
  } catch {
    // Postgres holds the event log, so clients catch up over the backup link.
  }
}

/** Missed events from the replay buffer, or null when the buffer cannot cover them. */
export async function replayFromBuffer(
  roomId: string,
  afterId: number,
): Promise<RoomEvent[] | null> {
  try {
    const raw = await commands.lrange(eventsKey(roomId), 0, -1);
    const events = raw.map((entry: string) => JSON.parse(entry) as RoomEvent);
    const oldest = events[0];
    if (!oldest) return null;
    if (oldest.id > afterId + 1) return null;
    return events.filter((event) => event.id > afterId);
  } catch {
    return null;
  }
}

export async function writeLeaderboard(
  roomId: string,
  entries: readonly { seatId: string; score: number }[],
): Promise<void> {
  if (entries.length === 0) return;
  const members = entries.flatMap((entry) => [entry.score, entry.seatId] as [number, string]);
  try {
    await commands.multi().del(leaderboardKey(roomId)).zadd(leaderboardKey(roomId), ...members).exec();
  } catch {
    // Rebuilt from Postgres standings when the live service returns.
  }
}

export async function addLiveClient(roomId: string, clientId: string): Promise<void> {
  try {
    await commands.sadd(clientsKey(roomId), clientId);
  } catch {
    // Presence also lives in Postgres, which the backup link reads.
  }
}

export async function removeLiveClient(roomId: string, clientId: string): Promise<void> {
  try {
    await commands.srem(clientsKey(roomId), clientId);
  } catch {
    // Presence also lives in Postgres, which the backup link reads.
  }
}

export async function expireRoomKeys(roomId: string): Promise<void> {
  try {
    await commands
      .multi()
      .expire(leaderboardKey(roomId), ROOM_KEY_TTL_SECONDS)
      .expire(clientsKey(roomId), ROOM_KEY_TTL_SECONDS)
      .expire(eventsKey(roomId), ROOM_KEY_TTL_SECONDS)
      .exec();
  } catch {
    // The keys are unused once the night is over.
  }
}

export async function subscribeRoom(
  roomId: string,
  handler: (event: RoomEvent) => void,
): Promise<() => void> {
  let handlers = roomHandlers.get(roomId);
  if (!handlers) {
    handlers = new Set();
    roomHandlers.set(roomId, handlers);
    await subscriber.subscribe(channelOf(roomId));
  }
  handlers.add(handler);
  return () => {
    const current = roomHandlers.get(roomId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      roomHandlers.delete(roomId);
      void subscriber.unsubscribe(channelOf(roomId)).catch(() => undefined);
    }
  };
}

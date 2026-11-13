import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

type Relay = (channel: string, message: string) => void;

const memoryKeys = new Map<string, { value: string; expiresAt: number }>();
let relay: Relay = () => {};
let commands: RedisClientType | null = null;
let connected = false;

/** An unreachable Valkey may be configured with an http scheme; the client needs a redis one. */
function redisUrl(): string {
  return config.valkeyUrl.replace(/^https?:\/\//, 'redis://');
}

function makeClient(): RedisClientType {
  const client: RedisClientType = createClient({
    url: redisUrl(),
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  client.on('error', () => {
    connected = false;
  });
  return client;
}

function drop(client: RedisClientType | null): void {
  if (!client) return;
  void client.disconnect().catch(() => undefined);
}

function retry(): void {
  setTimeout(() => {
    void attempt();
  }, 2000);
}

async function attempt(): Promise<void> {
  let fresh: { commands: RedisClientType; subscriber: RedisClientType };
  try {
    fresh = { commands: makeClient(), subscriber: makeClient() };
  } catch {
    retry();
    return;
  }
  try {
    await Promise.all([
      Promise.race([
        fresh.commands.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
      ]),
      Promise.race([
        fresh.subscriber.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
      ]),
    ]);
    await fresh.subscriber.pSubscribe('match:*', (message: string, channel: string) =>
      relay(channel, message),
    );
    await fresh.subscriber.pSubscribe('tournament:*', (message: string, channel: string) =>
      relay(channel, message),
    );
  } catch {
    drop(fresh.commands);
    drop(fresh.subscriber);
    connected = false;
    retry();
    return;
  }
  for (const client of [fresh.commands, fresh.subscriber]) {
    client.on('end', () => {
      if (commands !== fresh.commands) return;
      connected = false;
      commands = null;
      drop(fresh.commands);
      drop(fresh.subscriber);
      retry();
    });
  }
  commands = fresh.commands;
  connected = true;
}

export function startLive(onMessage: Relay): void {
  relay = onMessage;
  void attempt();
}

export function liveUp(): boolean {
  return connected && commands?.isReady === true;
}

export async function liveReachable(): Promise<boolean> {
  if (!commands || !commands.isReady) return false;
  try {
    const pong = await Promise.race([
      commands.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function publish(channel: string, message: string): Promise<void> {
  if (!commands || !commands.isReady) return;
  try {
    await commands.publish(channel, message);
  } catch {
    connected = false;
  }
}

function memoryGet(key: string): string | null {
  const entry = memoryKeys.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryKeys.delete(key);
    return null;
  }
  return entry.value;
}

export async function penGet(matchId: string): Promise<string | null> {
  const key = `pen:${matchId}`;
  if (commands && commands.isReady) {
    try {
      return await commands.get(key);
    } catch {
      connected = false;
    }
  }
  return memoryGet(key);
}

export async function penAcquire(matchId: string, value: string): Promise<boolean> {
  const key = `pen:${matchId}`;
  if (commands && commands.isReady) {
    try {
      const reply = await commands.set(key, value, { NX: true, PX: config.penGraceMs });
      return reply === 'OK';
    } catch {
      connected = false;
    }
  }
  if (memoryGet(key) !== null) return false;
  memoryKeys.set(key, { value, expiresAt: Date.now() + config.penGraceMs });
  return true;
}

export async function penRenew(matchId: string, value: string): Promise<void> {
  const key = `pen:${matchId}`;
  if (commands && commands.isReady) {
    try {
      const current = await commands.get(key);
      if (current === value) await commands.pExpire(key, config.penGraceMs);
      return;
    } catch {
      connected = false;
    }
  }
  if (memoryGet(key) === value) {
    memoryKeys.set(key, { value, expiresAt: Date.now() + config.penGraceMs });
  }
}

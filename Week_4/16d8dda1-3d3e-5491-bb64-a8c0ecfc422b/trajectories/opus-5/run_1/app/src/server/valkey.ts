import { Redis } from 'ioredis';
import { config } from './config.js';

export const EVENTS_CHANNEL = 'sh:events';

export interface BusEvent {
  sessionId: string;
  event: string;
  instance: string;
  message?: unknown;
}

type StatusListener = (available: boolean) => void;
type EventListener = (event: BusEvent) => void;

function connection(): Redis {
  return new Redis(config.valkeyUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: () => 1_000,
    reconnectOnError: () => true,
    lazyConnect: true
  });
}

class LiveBus {
  private readonly commands = connection();
  private readonly subscriber = connection();
  private connected = false;
  private forcedDown = false;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly eventListeners = new Set<EventListener>();

  start(): void {
    this.commands.on('ready', () => this.setConnected(true));
    this.commands.on('end', () => this.setConnected(false));
    this.commands.on('close', () => this.setConnected(false));
    this.commands.on('error', () => this.setConnected(false));
    this.subscriber.on('ready', () => {
      void this.subscriber.subscribe(EVENTS_CHANNEL);
    });
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (channel, payload) => {
      if (channel !== EVENTS_CHANNEL) return;
      try {
        const event = JSON.parse(payload) as BusEvent;
        for (const listener of this.eventListeners) listener(event);
      } catch {
        /* a malformed bus payload cannot come from this app */
      }
    });
    void this.commands.connect().catch(() => undefined);
    void this.subscriber.connect().catch(() => undefined);
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.announceStatus();
  }

  private announceStatus(): void {
    const available = this.available();
    for (const listener of this.statusListeners) listener(available);
  }

  available(): boolean {
    return this.connected && !this.forcedDown;
  }

  setForcedDown(down: boolean): void {
    if (this.forcedDown === down) return;
    this.forcedDown = down;
    this.announceStatus();
  }

  onStatus(listener: StatusListener): void {
    this.statusListeners.add(listener);
  }

  onEvent(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /** Every command goes through here so a forced outage takes the same path as a real one. */
  client(): Redis {
    if (!this.available()) throw new Error('valkey unavailable');
    return this.commands;
  }

  async publish(event: BusEvent): Promise<void> {
    await this.client().publish(EVENTS_CHANNEL, JSON.stringify(event));
  }
}

export const bus = new LiveBus();

export const keys = {
  seats: (sessionId: string) => `sh:${sessionId}:seats`,
  seatOf: (sessionId: string) => `sh:${sessionId}:seat-of`,
  slide: (sessionId: string) => `sh:${sessionId}:slide`,
  hands: (sessionId: string) => `sh:${sessionId}:hands`,
  poll: (sessionId: string, pollId: string) => `sh:${sessionId}:poll:${pollId}`,
  flags: (sessionId: string) => `sh:${sessionId}:flags`,
  breakout: (sessionId: string) => `sh:${sessionId}:breakout`,
  breakoutMembers: (sessionId: string) => `sh:${sessionId}:breakout:members`,
  online: (sessionId: string) => `sh:${sessionId}:online`,
  heartbeat: (sessionId: string, instance: string) => `sh:${sessionId}:heartbeat:${instance}`,
  ready: (sessionId: string) => `sh:${sessionId}:ready`
};

export function sessionKeys(sessionId: string, pollIds: string[]): string[] {
  return [
    keys.seats(sessionId),
    keys.seatOf(sessionId),
    keys.slide(sessionId),
    keys.hands(sessionId),
    keys.flags(sessionId),
    keys.breakout(sessionId),
    keys.breakoutMembers(sessionId),
    keys.online(sessionId),
    keys.ready(sessionId),
    ...pollIds.map((pollId) => keys.poll(sessionId, pollId))
  ];
}

/**
 * DP-08: the seat claim the server receives first wins, decided in one step
 * in Valkey. Returns the current holder when the claim loses.
 */
const claimSeatScript = `
local holder = redis.call('HGET', KEYS[1], ARGV[1])
if holder and holder ~= ARGV[2] then return {'taken', holder} end
local previous = redis.call('HGET', KEYS[2], ARGV[2])
if previous and previous ~= ARGV[1] then redis.call('HDEL', KEYS[1], previous) end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[1])
return {'won', previous or ''}
`;

const raiseHandScript = `
local hands = redis.call('LRANGE', KEYS[1], 0, -1)
for _, learner in ipairs(hands) do
  if learner == ARGV[1] then return 0 end
end
redis.call('RPUSH', KEYS[1], ARGV[1])
return 1
`;

export async function claimSeat(
  sessionId: string,
  seatId: string,
  learnerId: string
): Promise<{ won: boolean; holder: string | null; previousSeat: string | null }> {
  const result = (await bus
    .client()
    .eval(claimSeatScript, 2, keys.seats(sessionId), keys.seatOf(sessionId), seatId, learnerId)) as [string, string];
  if (result[0] === 'taken') return { won: false, holder: result[1], previousSeat: null };
  return { won: true, holder: learnerId, previousSeat: result[1] === '' ? null : result[1] };
}

export async function raiseHand(sessionId: string, learnerId: string): Promise<boolean> {
  const added = (await bus.client().eval(raiseHandScript, 1, keys.hands(sessionId), learnerId)) as number;
  return added === 1;
}

import Redis from 'ioredis';
import { config } from './config.js';

export const valkey = new Redis(config.valkeyUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
});

valkey.on('error', () => {
  // Reconnection is handled by the client; losing Valkey is a rebuildable state.
});

export async function waitForValkey(): Promise<void> {
  await valkey.connect().catch(() => undefined);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await valkey.ping();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Valkey is not reachable');
}

export async function valkeyReachable(): Promise<boolean> {
  try {
    await valkey.ping();
    return true;
  } catch {
    return false;
  }
}

export const keys = {
  hold: (rideId: string, legIndex: number, seat: number) =>
    `longseat:hold:${rideId}:${legIndex}:${seat}`,
  requestDeadlines: 'longseat:request-deadlines',
  presence: (bookingId: string) => `longseat:presence:${bookingId}`,
  lastSeen: 'longseat:last-seen',
  rateRequests: (memberId: string) => `longseat:rate:requests:${memberId}`,
  rateMessages: (memberId: string) => `longseat:rate:messages:${memberId}`,
  rateCodes: (email: string) => `longseat:rate:codes:${email}`,
};

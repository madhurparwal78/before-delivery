import type { Valkey } from '../db/valkey.js';

/**
 * Valkey key layout for holds, request deadlines, presence, last-seen and rate counters,
 * with rebuild-from-PostgreSQL behaviour when the fast store is lost.
 */

export const NS = 'longseat';

export class ValkeyStore {
  constructor(readonly v: Valkey) {}

  holdKey(rideId: string, legIndex: number, seat: number): string {
    return `${NS}:hold:${rideId}:${legIndex}:${seat}`;
  }

  async putHold(rideId: string, legIndex: number, seat: number, bookingId: string, ttlSeconds: number): Promise<void> {
    const key = this.holdKey(rideId, legIndex, seat);
    await this.v.cmd('SET', key, bookingId, 'EX', String(Math.max(1, Math.round(ttlSeconds))));
  }

  async dropHold(rideId: string, legIndex: number, seat: number): Promise<void> {
    await this.v.cmd('DEL', this.holdKey(rideId, legIndex, seat));
  }

  async holdsForRide(rideId: string, legCount: number, seats: number): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let leg = 0; leg < legCount; leg++) {
      for (let seat = 1; seat <= seats; seat++) {
        const key = this.holdKey(rideId, leg, seat);
        const v = await this.v.cmd('GET', key);
        if (typeof v === 'string') out.set(`${leg}:${seat}`, v);
      }
    }
    return out;
  }

  async zAdd(setKey: string, scoreMs: number, member: string): Promise<void> {
    await this.v.cmd('ZADD', setKey, String(scoreMs), member);
  }

  async zRemove(setKey: string, member: string): Promise<void> {
    await this.v.cmd('ZREM', setKey, member);
  }

  async zRangeByScore(setKey: string, min: number, max: number): Promise<string[]> {
    const r = await this.v.cmd('ZRANGEBYSCORE', setKey, String(min), String(max));
    return Array.isArray(r) ? (r as string[]) : [];
  }

  async sAdd(setKey: string, member: string): Promise<void> {
    await this.v.cmd('SADD', setKey, member);
  }

  async sRemove(setKey: string, member: string): Promise<void> {
    await this.v.cmd('SREM', setKey, member);
  }

  async sMembers(setKey: string): Promise<string[]> {
    const r = await this.v.cmd('SMEMBERS', setKey);
    return Array.isArray(r) ? (r as string[]) : [];
  }

  async hSet(hashKey: string, field: string, value: string): Promise<void> {
    await this.v.cmd('HSET', hashKey, field, value);
  }

  async hGet(hashKey: string, field: string): Promise<string | null> {
    const r = await this.v.cmd('HGET', hashKey, field);
    return typeof r === 'string' ? r : null;
  }

  async delKey(key: string): Promise<void> {
    await this.v.cmd('DEL', key);
  }

  presenceKey(bookingId: string): string {
    return `${NS}:presence:${bookingId}`;
  }

  lastSeenHash(): string {
    return `${NS}:last-seen`;
  }

  requestDeadlinesKey(): string {
    return `${NS}:request-deadlines`;
  }

  rateKey(kind: 'requests' | 'messages' | 'codes', identity: string): string {
    return `${NS}:rate:${kind}:${identity}`;
  }
}

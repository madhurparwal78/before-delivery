/**
 * Valkey key layout for holds, request deadlines, presence, last-seen and rate counters,
 * with rebuild-from-PostgreSQL behaviour when the fast store is lost.
 */
export const NS = 'longseat';
export class ValkeyStore {
    v;
    constructor(v) {
        this.v = v;
    }
    holdKey(rideId, legIndex, seat) {
        return `${NS}:hold:${rideId}:${legIndex}:${seat}`;
    }
    async putHold(rideId, legIndex, seat, bookingId, ttlSeconds) {
        const key = this.holdKey(rideId, legIndex, seat);
        await this.v.cmd('SET', key, bookingId, 'EX', String(Math.max(1, Math.round(ttlSeconds))));
    }
    async dropHold(rideId, legIndex, seat) {
        await this.v.cmd('DEL', this.holdKey(rideId, legIndex, seat));
    }
    async holdsForRide(rideId, legCount, seats) {
        const out = new Map();
        for (let leg = 0; leg < legCount; leg++) {
            for (let seat = 1; seat <= seats; seat++) {
                const key = this.holdKey(rideId, leg, seat);
                const v = await this.v.cmd('GET', key);
                if (typeof v === 'string')
                    out.set(`${leg}:${seat}`, v);
            }
        }
        return out;
    }
    async zAdd(setKey, scoreMs, member) {
        await this.v.cmd('ZADD', setKey, String(scoreMs), member);
    }
    async zRemove(setKey, member) {
        await this.v.cmd('ZREM', setKey, member);
    }
    async zRangeByScore(setKey, min, max) {
        const r = await this.v.cmd('ZRANGEBYSCORE', setKey, String(min), String(max));
        return Array.isArray(r) ? r : [];
    }
    async sAdd(setKey, member) {
        await this.v.cmd('SADD', setKey, member);
    }
    async sRemove(setKey, member) {
        await this.v.cmd('SREM', setKey, member);
    }
    async sMembers(setKey) {
        const r = await this.v.cmd('SMEMBERS', setKey);
        return Array.isArray(r) ? r : [];
    }
    async hSet(hashKey, field, value) {
        await this.v.cmd('HSET', hashKey, field, value);
    }
    async hGet(hashKey, field) {
        const r = await this.v.cmd('HGET', hashKey, field);
        return typeof r === 'string' ? r : null;
    }
    async delKey(key) {
        await this.v.cmd('DEL', key);
    }
    presenceKey(bookingId) {
        return `${NS}:presence:${bookingId}`;
    }
    lastSeenHash() {
        return `${NS}:last-seen`;
    }
    requestDeadlinesKey() {
        return `${NS}:request-deadlines`;
    }
    rateKey(kind, identity) {
        return `${NS}:rate:${kind}:${identity}`;
    }
}

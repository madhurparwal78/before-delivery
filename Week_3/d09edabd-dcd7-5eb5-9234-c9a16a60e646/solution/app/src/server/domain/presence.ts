import { hub, roomChannel } from '../events.js';
import { valkey } from '../valkey.js';
import type { LockHolder } from '../../shared/types.js';

const TTL_SECONDS = 30;
const REFRESH_MS = 10_000;
const WATCH_MS = 3000;

const keyOf = (roomId: string, userId: string): string => `presence:${roomId}:${userId}`;

interface Watched {
  users: Map<string, { name: string; streams: number }>;
  last: string;
  timer: NodeJS.Timeout;
  refreshed: number;
}

/** Who has a room open: one Valkey key per member, refreshed while a stream is open; every instance reports changes it sees. */
class Presence {
  private readonly rooms = new Map<string, Watched>();

  async members(roomId: string): Promise<LockHolder[]> {
    const keys = await valkey.keys(`presence:${roomId}:*`);
    const names = await valkey.values(keys);
    return keys.map((key, i) => ({ userId: key.split(':')[2]!, displayName: names[i] ?? '' })).filter((m) => m.displayName !== '').sort((a, b) => a.userId.localeCompare(b.userId));
  }

  join(roomId: string, userId: string, displayName: string): () => void {
    let watched = this.rooms.get(roomId);
    if (!watched) {
      watched = { users: new Map(), last: '', refreshed: 0, timer: setInterval(() => void this.tick(roomId), WATCH_MS) };
      this.rooms.set(roomId, watched);
    }
    const user = watched.users.get(userId) ?? { name: displayName, streams: 0 };
    user.streams += 1;
    watched.users.set(userId, user);
    void this.touch(roomId, userId, displayName).then(() => this.tick(roomId));
    return () => {
      user.streams -= 1;
      if (user.streams > 0) return;
      watched!.users.delete(userId);
      void valkey.remove(keyOf(roomId, userId)).catch(() => undefined).then(() => this.tick(roomId));
      if (watched!.users.size === 0) {
        clearInterval(watched!.timer);
        this.rooms.delete(roomId);
      }
    };
  }

  private async touch(roomId: string, userId: string, name: string): Promise<void> {
    await valkey.setWithTtl(keyOf(roomId, userId), name, TTL_SECONDS).catch(() => undefined);
  }

  private async tick(roomId: string): Promise<void> {
    const watched = this.rooms.get(roomId);
    if (!watched || !valkey.available) return;
    if (Date.now() - watched.refreshed >= REFRESH_MS) {
      watched.refreshed = Date.now();
      for (const [userId, user] of watched.users) await this.touch(roomId, userId, user.name);
    }
    try {
      const members = await this.members(roomId);
      const signature = JSON.stringify(members);
      if (signature !== watched.last) {
        watched.last = signature;
        await hub.publish(roomChannel(roomId), 'presence', { members });
      }
    } catch {
      watched.last = '';
    }
  }
}

export const presence = new Presence();

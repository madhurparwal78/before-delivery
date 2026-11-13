import type { Db } from './db.js';

export type Presence = 'online' | 'in_match' | 'offline';

/**
 * Presence is derived from live connections held in memory; a player with any
 * live connection is online, and in-match when they hold an in-play match.
 */
export class PresenceRegistry {
  private liveSessions = new Map<string, { playerId: string; lastSeen: number }>();

  connected(sessionId: string, playerId: string): void {
    this.liveSessions.set(sessionId, { playerId, lastSeen: Date.now() });
  }

  heartbeat(sessionId: string): void {
    const entry = this.liveSessions.get(sessionId);
    if (entry) entry.lastSeen = Date.now();
  }

  disconnected(sessionId: string): void {
    this.liveSessions.delete(sessionId);
  }

  isOnline(playerId: string): boolean {
    for (const entry of this.liveSessions.values()) {
      if (entry.playerId === playerId && Date.now() - entry.lastSeen < 45_000) return true;
    }
    return false;
  }

  async presence(db: Db, playerId: string): Promise<Presence> {
    if (!this.isOnline(playerId)) return 'offline';
    const res = await db.query(
      `SELECT 1 FROM matches m
       WHERE m.status IN ('paired','in_play')
         AND (m.seat1_player = $1 OR m.seat2_player = $1)
       LIMIT 1`,
      [playerId]
    );
    return (res.rowCount ?? 0) > 0 ? 'in_match' : 'online';
  }
}

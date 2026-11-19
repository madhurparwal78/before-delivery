// Presence and live cursors. Held in memory because cursors and presence
// carry no sequence number and never touch Postgres.
import type { Express, Request } from 'express';
import { requireUser } from './http.js';
import { getSprite } from './sprites.js';
import { requireMember } from './projects.js';
import { nowMs } from './clock.js';
import { forbidden } from './errors.js';
import { config } from './http.js';

interface CursorState { name: string; userId: number; x: number; y: number; frame: number; at: number }
interface PresenceState { name: string; userId: number; joinedAt: number; lastActive: number }

const cursorsBySprite = new Map<number, Map<string, CursorState>>();
const presenceBySprite = new Map<number, PresenceState[]>();

export function registerPresenceRoutes(app: Express): void {
  app.post('/api/sprites/:id/cursors', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      if (role === 'reviewer') throw forbidden("Reviewers can't draw");
      const body = req.body as Record<string, unknown>;
      const key = `${user.id}`;
      let byUser = cursorsBySprite.get(Number(sprite.id));
      if (!byUser) { byUser = new Map(); cursorsBySprite.set(Number(sprite.id), byUser); }
      byUser.set(key, {
        name: user.name, userId: user.id,
        x: Number(body['x'] ?? 0), y: Number(body['y'] ?? 0), frame: Number(body['frame'] ?? 1),
        at: Date.now()
      });
      // presence in join order
      let presence = presenceBySprite.get(Number(sprite.id));
      if (!presence) { presence = []; presenceBySprite.set(Number(sprite.id), presence); }
      if (!presence.some((p) => p.userId === user.id)) {
        presence.push({ name: user.name, userId: user.id, joinedAt: Date.now(), lastActive: Date.now() });
      } else {
        const entry = presence.find((p) => p.userId === user.id)!;
        entry.lastActive = Date.now();
      }
      res.status(204).end();
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id/presence', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const now = await nowMs();
      const presence = presenceBySprite.get(Number(sprite.id)) ?? [];
      const items = presence.map((p) => ({
        name: p.name,
        idle: now - p.lastActive > config.idleSeconds * 1000,
        joined_at: p.joinedAt
      }));
      const cursors = (cursorsBySprite.get(Number(sprite.id)) ?? new Map());
      const cursorItems = Array.from(cursors.values()).map((c) => ({
        person: c.name, x: c.x, y: c.y, frame: c.frame, at: c.at
      }));
      res.json({ presence: items.sort((a, b) => a.joined_at - b.joined_at), cursors: cursorItems });
    } catch (e) { next(e); }
  });
}

/** Drop a person's presence when their last tab closes. */
export function dropPresence(userId: number): void {
  for (const [, list] of presenceBySprite) {
    const idx = list.findIndex((p) => p.userId === userId);
    if (idx !== -1) list.splice(idx, 1);
  }
  for (const [, byUser] of cursorsBySprite) {
    byUser.delete(String(userId));
  }
}

export function presenceForSprite(spriteId: number): PresenceState[] {
  return presenceBySprite.get(spriteId) ?? [];
}

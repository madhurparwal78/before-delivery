import { hub, roomChannel } from '../events.js';
import { route } from '../http.js';
import { presence } from '../domain/presence.js';
import { lockView } from '../domain/locks.js';
import { findRoom } from '../domain/rooms.js';
import { openEventStream } from '../sse.js';
import { valkey } from '../valkey.js';
import { db } from '../db.js';
import type { LockTarget } from '../../shared/types.js';

export function liveRoutes(): void {
  route('GET', '/api/rooms/:roomId/events', {
    auth: 'member',
    load: (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!),
    run: async (ctx, room) => ({
      stream: (res) => {
        const writer = openEventStream(res);
        const me = { userId: ctx.actor.userId, displayName: ctx.actor.displayName };
        const channel = roomChannel(room.id);
        const own = (): void => writer.send('presence', { members: [me] });
        let leave: (() => void) | null = null;
        const attach = (): void => {
          leave ??= presence.join(room.id, me.userId, me.displayName);
        };
        writer.onClose(() => leave?.());
        writer.onClose(
          hub.subscribe(channel, (event, data) => {
            writer.send(event, data);
            if (event !== 'live') return;
            if ((data as { available: boolean }).available) {
              attach();
              void sendLocks();
            } else {
              leave?.();
              leave = null;
              own();
            }
          }),
        );
        writer.send('live', { available: valkey.available });
        if (valkey.available) {
          attach();
          void sendLocks();
        } else {
          own();
        }

        async function sendLocks(): Promise<void> {
          try {
            for (const key of await valkey.keys(`lock:${room.id}:*`)) {
              const [, , type, targetId] = key.split(':') as [string, string, LockTarget, string];
              const held = await valkey.lockHolder(key);
              if (held) writer.send('lock', { lock: await lockView(db, type, targetId, held.holderId, held.ttlMs) });
            }
          } catch {
            // Locks learned later arrive as events.
          }
        }
      },
    }),
  });
}


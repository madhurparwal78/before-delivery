import { ApiError } from '../../shared/errors.ts';
import type { ViewReport } from '../../shared/model.ts';
import { principalFromCookies } from '../auth.ts';
import { database } from '../db.ts';
import { colourOf, join, keepAlive, leave, noteSeq, presenceList, release, replayEvents, sendSocket, seqOf, transient, type Connection } from '../hub.ts';
import { accessMap } from '../mapStore.ts';
import { acceptUpgrade, upgradeRoute } from '../upgrade.ts';

const isFinite2 = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function viewOf(value: unknown): ViewReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return isFinite2(v.zoom) && isFinite2(v.pan_x) && isFinite2(v.pan_y) && isFinite2(v.width) && isFinite2(v.height)
    ? { zoom: v.zoom, pan_x: v.pan_x, pan_y: v.pan_y, width: v.width, height: v.height }
    : null;
}

upgradeRoute('/api/maps/:id/live', async (ctx) => {
  const principal = await principalFromCookies(ctx.cookies);
  if (!principal) throw new ApiError('unauthenticated', 'Sign in to continue.');
  const mapId = ctx.params.id ?? '';
  const { map, role } = await accessMap(database(), mapId, principal);
  noteSeq(mapId, map.seq);
  const since = Number(ctx.query.get('since') ?? Number.NaN);
  const ws = await acceptUpgrade(ctx);
  const conn: Connection = { ws, mapId, principal, role, expiredNotified: false, held: [] };
  join(conn);
  const stopPing = keepAlive(ws);
  ws.on('close', () => {
    stopPing();
    leave(conn);
  });
  ws.on('message', (data) => {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'cursor') return;
    const cursor = message as Record<string, unknown>;
    if (!isFinite2(cursor.x) || !isFinite2(cursor.y)) return;
    transient(
      mapId,
      {
        type: 'cursor',
        user: principal.name,
        colour: colourOf(mapId, principal.id),
        x: cursor.x,
        y: cursor.y,
        topic_id: typeof cursor.topic_id === 'string' ? cursor.topic_id : null,
        view: viewOf(cursor.view),
      },
      null,
      ws,
    );
  });
  if (Number.isFinite(since)) {
    for (const message of await replayEvents(mapId, since, { id: principal.id, role })) sendSocket(ws, message);
  }
  sendSocket(ws, { seq: seqOf(mapId), type: 'presence', people: presenceList(mapId) });
  release(conn);
});

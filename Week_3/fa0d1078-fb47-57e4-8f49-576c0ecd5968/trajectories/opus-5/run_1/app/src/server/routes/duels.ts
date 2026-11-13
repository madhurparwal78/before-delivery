import { isLevel, type Level } from '../../shared/puzzles';
import { createRoom, joinRoom, roomFor } from '../duels';
import { ApiError } from '../errors';
import { sendJson, type Router } from '../http';
import { requirePlayer, requireVerifiedPlayer } from '../players';

const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function levelFrom(body: unknown): Level {
  const value = typeof body === 'object' && body !== null ? (body as { level?: unknown }).level : undefined;
  if (!isLevel(value)) throw new ApiError('VALIDATION', { fields: { level: 'Choose a level.' } });
  return value;
}

/** Lower case letters, spaces and hyphens are read as the code they spell. */
export function normaliseCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function registerDuelRoutes(router: Router): void {
  router.post('/api/duels', async (context) => {
    const player = await requireVerifiedPlayer(context);
    const level = levelFrom(context.body);
    sendJson(context.res, 201, { room: await createRoom(player, level) });
  });

  router.post('/api/duels/join', async (context) => {
    const player = await requireVerifiedPlayer(context);
    const code = normaliseCode(
      typeof context.body === 'object' && context.body !== null
        ? (context.body as { code?: unknown }).code
        : undefined,
    );
    sendJson(context.res, 200, { room: await joinRoom(player, code) });
  });

  router.get('/api/duels/:code', async (context) => {
    const player = await requirePlayer(context);
    const code = normaliseCode(context.params.code);
    if (!CODE_PATTERN.test(code)) throw new ApiError('ROOM_NOT_FOUND');
    sendJson(context.res, 200, { room: await roomFor(player, code) });
  });
}

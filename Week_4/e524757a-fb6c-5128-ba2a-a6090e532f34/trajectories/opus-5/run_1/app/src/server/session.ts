import { ApiError } from '../shared/errors.js';
import { cookies, type Ctx } from './http.js';
import { playerBySession, type PlayerRow } from './domain/players.js';

export type Viewer = { player: PlayerRow | null; sessionId: string | null };

export async function viewerOf(ctx: Ctx): Promise<Viewer> {
  const sessionId = cookies(ctx).hushfoot ?? null;
  if (!sessionId) return { player: null, sessionId: null };
  return { player: await playerBySession(sessionId), sessionId };
}

export async function requirePlayer(ctx: Ctx): Promise<PlayerRow> {
  const viewer = await viewerOf(ctx);
  if (!viewer.player) throw new ApiError('not_signed_in');
  return viewer.player;
}

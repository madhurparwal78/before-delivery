import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { read } from '../access.js';
import { userFor } from '../auth.js';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { sameOrigin, crossSite } from '../http.js';
import { accept, reject, type Viewer } from '../live.js';
import { MSG } from '../messages.js';
import { loadTournamentByShare } from '../repo.js';

// WebSocket upgrades for /api/tournaments/<id>/live, with the session cookie or ?share=<share code>.
async function viewerFor(req: IncomingMessage, id: string, share: string | null): Promise<Viewer> {
  if (share) {
    const t = await loadTournamentByShare(pool, share);
    if (!t || t.id !== id) throw new ApiError('not_found', MSG.linkDead);
    if (t.state === 'draft') throw new ApiError('not_found', MSG.notPublic);
    return { kind: 'public', shareCode: share };
  }
  const user = await userFor(req);
  if (!user) throw new ApiError('unauthenticated', MSG.unauthenticated);
  return { kind: 'user', role: (await read(user, id)).role };
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/api\/tournaments\/([^/]+)\/live$/.exec(url.pathname);
    if (!match) throw new ApiError('not_found', MSG.pageNotFound);
    if (!sameOrigin(req)) throw crossSite();
    const id = decodeURIComponent(match[1] as string);
    const viewer = await viewerFor(req, id, url.searchParams.get('share'));
    const after = url.searchParams.get('after');
    await accept(req, socket, head, id, viewer, after !== null && /^\d+$/.test(after) ? Number(after) : null);
  } catch (error) {
    if (error instanceof ApiError) return reject(socket, error);
    console.error(error);
    socket.destroy();
  }
}

import { acceptEvent, eventRefusal, recordRefusal, validateEvent, verifyEvent } from '../events.js';
import type { GameSecrets } from '../events.js';
import { pool } from '../db.js';
import { HttpError, notFound, parseJsonObject, route } from '../http.js';

export const hookRoutes = [
  route(
    'POST',
    '/api/hooks/:game/events',
    async (ctx) => {
      const { rows } = await pool.query<GameSecrets>(
        'select id, slug, server_secret, previous_server_secret, previous_valid_until from games where slug = $1',
        [ctx.params.game],
      );
      const game = rows[0];
      if (!game) throw notFound();
      const raw = await ctx.rawBody();
      if (!/^application\/json\b/i.test(ctx.req.headers['content-type'] ?? '')) {
        throw new HttpError(415, 'unsupported_media_type', 'Send application/json.');
      }
      const headers = {
        timestamp: String(ctx.req.headers['x-hushline-timestamp'] ?? ''),
        signature: String(ctx.req.headers['x-hushline-signature'] ?? ''),
      };
      const verification = verifyEvent(game, headers, raw, Date.now() / 1000);
      if (!verification.ok) {
        await recordRefusal(game, parseJsonObject(raw), verification.reason);
        throw eventRefusal(verification.code);
      }
      const body = parseJsonObject(raw);
      const event = validateEvent(body);
      const outcome = await acceptEvent(game, event, verification.verdict, body);
      if ('refusedNonce' in outcome) throw eventRefusal('nonce_seen');
      return { status: outcome.status, body: outcome.body };
    },
    { lazyBody: true },
  ),
];

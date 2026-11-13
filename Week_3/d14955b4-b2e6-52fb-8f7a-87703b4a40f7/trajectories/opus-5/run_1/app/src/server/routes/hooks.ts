import { limits } from '../config';
import { ApiError, notFound } from '../errors';
import {
  acceptEvent,
  claimNonce,
  recordRefusedEvent,
  timestampInWindow,
  validateEventBody,
  verifyEventSignature,
  type RefusalReason,
} from '../domain/events';
import { findGameBySlug } from '../data/games';
import { contentTypeEssence, readRawBody, sendJson, type Router } from '../http';

function parseOrNull(raw: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function registerHookRoutes(router: Router): void {
  router.add('POST', '/api/hooks/:game/events', async (ctx) => {
    const game = await findGameBySlug(ctx.params.game as string);
    if (!game) throw notFound();
    const declared = Number(ctx.req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limits.eventBodyBytes) {
      throw new ApiError(413, 'too_large');
    }
    if (contentTypeEssence(ctx.req) !== 'application/json') {
      throw new ApiError(415, 'unsupported_media_type');
    }
    const raw = await readRawBody(ctx, limits.eventBodyBytes);
    const timestamp = String(ctx.req.headers['x-hushline-timestamp'] ?? '');
    const signature = String(ctx.req.headers['x-hushline-signature'] ?? '');

    const refuse = async (status: number, code: string, reason: RefusalReason): Promise<never> => {
      await recordRefusedEvent(game, parseOrNull(raw), reason);
      throw new ApiError(status, code);
    };

    const source = verifyEventSignature(game, timestamp, raw, signature);
    if (source === null) await refuse(401, 'bad_signature', 'bad signature');
    if (!timestampInWindow(timestamp)) await refuse(401, 'stale_timestamp', 'outside the 300 s window');

    const body = validateEventBody(parseOrNull(raw) ?? {});
    if (!(await claimNonce(game.id, body.nonce))) {
      await refuse(409, 'nonce_seen', 'nonce already seen');
    }
    const outcome = await acceptEvent(game, body, source ?? 'current');
    if (outcome.status === 200) {
      sendJson(ctx, 200, { status: 'duplicate', message_id: outcome.messageId });
      return;
    }
    sendJson(ctx, 201, { status: 'accepted', message_id: outcome.messageId });
  });
}

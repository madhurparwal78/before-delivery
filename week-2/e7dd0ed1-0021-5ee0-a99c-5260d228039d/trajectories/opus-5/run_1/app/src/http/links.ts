import { query, transaction } from '../db';
import { ApiError, RateLimited, apiError } from '../errors';
import { decryptBytes } from '../crypto/objects';
import { unwrapDataKey } from '../crypto/seal';
import { getBytes, regionObjectKey } from '../services/storage';
import { downloadHeaders, isRiskyType } from '../domain/content';
import { checkLinkRate, findLinkByToken, linkState } from '../domain/links';
import { recordEgressBytes, recordRequestUnits } from '../domain/usage';
import { header, setHeaders, type Context } from './core';
import type { Router } from './router';

export const recipientHeadings: Record<string, string> = {
  link_expired: 'This link has expired.',
  link_revoked: 'This link was revoked.',
  not_found: "This link doesn't exist.",
  workspace_suspended: 'This link is paused.',
};

export function recipientPage(heading: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Farshore</title><link rel="stylesheet" href="/assets/app.css"></head>
<body class="recipient"><main><h1>${heading}</h1></main></body></html>`;
}

/** Share-link responses carry only the headers Business rules allow. */
function sendLinkError(ctx: Context, error: ApiError): void {
  const heading =
    error instanceof RateLimited
      ? `Too many downloads right now. Try again in ${error.retryAfterSeconds} seconds.`
      : (recipientHeadings[error.code] ?? recipientHeadings.not_found);
  const accepts = (header(ctx, 'accept') ?? '').includes('text/html');
  ctx.res.statusCode = error.status;
  if (error instanceof RateLimited) ctx.res.setHeader('Retry-After', String(error.retryAfterSeconds));
  const body = accepts ? recipientPage(heading) : JSON.stringify({ error: error.code, message: heading });
  ctx.res.setHeader('Content-Type', accepts ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
  ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
}

export function registerLinkRoutes(router: Router): void {
  router.get('/l/:token', async (ctx) => {
    try {
      const link = await findLinkByToken(ctx.params.token);
      if (!link) throw apiError('not_found');
      await checkLinkRate(link.id);
      const workspace = await query<{ status: string }>('select status from workspaces where slug = $1', [link.workspace_slug]);
      if (workspace[0]?.status === 'suspended') throw apiError('workspace_suspended');
      const state = linkState(link);
      if (state === 'expired') throw apiError('link_expired');
      if (state === 'revoked') throw apiError('link_revoked');
      const version = await query<{
        version_id: string;
        bucket: string;
        object_key: string;
        size: string;
        etag: string;
        content_type: string;
        acknowledged_at: string;
        wrapped_data_key: string;
        key_generation: number;
        placement: string[];
      }>(
        `select v.version_id, v.bucket, v.object_key, v.size::text as size, v.etag, v.content_type, v.acknowledged_at,
                v.wrapped_data_key, v.key_generation, b.placement
         from object_versions v join buckets b on b.name = v.bucket where v.version_id = $1`,
        [link.version_id],
      );
      if (version.length === 0) throw apiError('link_revoked');
      const found = version[0];
      const ciphertext = await getBytes(regionObjectKey(found.placement[0], found.bucket, found.version_id));
      if (ciphertext === null) throw apiError('not_found');
      const bytes = decryptBytes(
        unwrapDataKey(link.workspace_slug, found.key_generation, found.wrapped_data_key),
        ciphertext,
      );
      if (ctx.method === 'GET') {
        await transaction(async (client) => {
          await recordRequestUnits(client, link.workspace_slug, found.bucket, 1);
          await recordEgressBytes(client, link.workspace_slug, found.bucket, bytes.length);
        });
      }
      setHeaders(ctx, downloadHeaders(found.object_key));
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', isRiskyType(found.content_type) ? 'application/octet-stream' : found.content_type);
      ctx.res.setHeader('Content-Length', bytes.length);
      ctx.res.setHeader('ETag', found.etag);
      ctx.res.setHeader('Last-Modified', new Date(found.acknowledged_at).toUTCString());
      ctx.res.end(ctx.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error instanceof ApiError) {
        sendLinkError(ctx, error);
        return;
      }
      throw error;
    }
  });
}

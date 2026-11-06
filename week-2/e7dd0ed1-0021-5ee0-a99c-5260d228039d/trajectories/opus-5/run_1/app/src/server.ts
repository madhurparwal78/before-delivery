import * as http from 'node:http';
import { config } from './config';
import { DatabaseUnavailable } from './db';
import { ApiError, S3Error, apiError, s3Error } from './errors';
import { applySchema } from './schema';
import { applySeed } from './seed';
import { StorageUnavailable } from './services/storage';
import { TagFilterError } from './domain/tagfilter';
import { CursorError } from './domain/listing';
import { buildContext, PayloadTooLarge, sendApiError, sendJson, sendS3Error, sendText, type Context } from './http/core';
import { Router } from './http/router';
import { registerSessionRoutes } from './http/api/session';
import { registerObjectRoutes } from './http/api/objects';
import { registerAdminRoutes } from './http/api/admin';
import { registerInviteRoutes } from './http/api/invites';
import { operatorGate, registerOpsRoutes } from './http/api/ops';
import { registerS3Routes, requestId } from './http/s3';
import { registerLinkRoutes } from './http/links';
import { registerPageRoutes } from './http/pages';
import { startWorkers } from './workers';
import { ensureCatalog, ensureTenant } from './services/killbill';

const router = new Router();
registerSessionRoutes(router);
registerObjectRoutes(router);
registerAdminRoutes(router);
registerInviteRoutes(router);
registerOpsRoutes(router);
registerS3Routes(router);
registerLinkRoutes(router);
registerPageRoutes(router);

function isS3Path(ctx: Context): boolean {
  return ctx.path === '/s3' || ctx.path.startsWith('/s3/');
}

function isApiPath(ctx: Context): boolean {
  return ctx.path === '/api' || ctx.path.startsWith('/api/');
}

function sendError(ctx: Context, error: unknown): void {
  if (ctx.res.headersSent) {
    ctx.res.end();
    return;
  }
  const s3 = isS3Path(ctx);
  if (error instanceof DatabaseUnavailable) {
    if (s3) return sendS3Error(ctx, s3Error('ServiceUnavailable'), requestId());
    if (isApiPath(ctx)) return sendApiError(ctx, apiError('service_unavailable', 'Farshore is temporarily unavailable.'));
    return sendText(ctx, 503, 'Service unavailable', 'text/plain; charset=utf-8');
  }
  if (error instanceof StorageUnavailable) {
    if (s3) return sendS3Error(ctx, s3Error('ServiceUnavailable'), requestId());
    return sendApiError(ctx, apiError('storage_unavailable', "Farshore can't reach storage right now."));
  }
  if (error instanceof PayloadTooLarge) {
    if (s3) return sendS3Error(ctx, s3Error('EntityTooLarge'), requestId());
    return sendApiError(ctx, apiError('payload_too_large', 'That request is too large.'));
  }
  if (error instanceof TagFilterError) {
    return sendApiError(ctx, apiError('validation_failed', 'Some fields need fixing.', { errors: { tag_filter: error.message } }));
  }
  if (error instanceof CursorError) {
    return sendApiError(ctx, apiError('validation_failed', 'Some fields need fixing.', { errors: { cursor: error.message } }));
  }
  if (error instanceof S3Error) return sendS3Error(ctx, error, requestId());
  if (error instanceof ApiError) {
    if (s3) return sendS3Error(ctx, s3Error('ServiceUnavailable'), requestId());
    return sendApiError(ctx, error);
  }
  process.stderr.write(`request failed: ${(error as Error).stack ?? String(error)}\n`);
  if (s3) return sendS3Error(ctx, s3Error('ServiceUnavailable'), requestId());
  if (isApiPath(ctx)) return sendApiError(ctx, apiError('service_unavailable', 'Farshore is temporarily unavailable.'));
  return sendText(ctx, 500, 'Something went wrong', 'text/plain; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  const ctx = buildContext(req, res);
  res.removeHeader('X-Powered-By');
  try {
    if (ctx.path === '/api/health') {
      sendJson(ctx, 200, { status: 'ok' });
      return;
    }
    if (ctx.path === '/api/ops' || ctx.path.startsWith('/api/ops/')) {
      await operatorGate(ctx);
    }
    const handler = router.match(ctx);
    if (!handler) {
      if (isS3Path(ctx)) throw s3Error('NotImplemented');
      if (isApiPath(ctx)) throw apiError('not_found');
      sendText(ctx, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    await handler(ctx);
  } catch (error) {
    sendError(ctx, error);
  }
});

async function prepare(): Promise<void> {
  try {
    await applySchema();
    await applySeed();
  } catch (error) {
    process.stderr.write(`startup preparation deferred: ${(error as Error).message}\n`);
    setTimeout(() => {
      void prepare();
    }, 3000).unref();
    return;
  }
  try {
    await ensureTenant();
    await ensureCatalog();
  } catch {
    /* Kill Bill is unreachable; the billing worker retries */
  }
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Farshore listening on ${config.port}\n`);
  void prepare();
  startWorkers();
});

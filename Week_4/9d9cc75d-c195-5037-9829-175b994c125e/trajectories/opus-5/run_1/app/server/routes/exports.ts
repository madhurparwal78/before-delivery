import { sheetAccess, workbookAccess } from '../access.js';
import { asObject, fail, requireUser, sendJson, str, type Router } from '../http.js';
import { parseFilters, parseParameterOverrides } from '../domain/parse.js';
import {
  contentTypeOf,
  createJob,
  extensionOf,
  findRunning,
  fingerprint,
  loadJob,
  publicJob,
  retryJob,
  subscribeJob,
  targetName,
  type ExportKind,
} from '../domain/exportjobs.js';
import { loadDashboardRecord } from '../domain/dashboards.js';
import { getObject } from '../storage.js';

const KINDS: ExportKind[] = ['pdf', 'png', 'csv'];

export function registerExports(router: Router): void {
  router.post('/api/exports', async (ctx) => {
    const user = requireUser(ctx);
    const body = asObject(await ctx.body());
    const kind = str(body.kind) as ExportKind | null;
    if (kind === null || !KINDS.includes(kind)) fail(422, 'invalid');
    const sheetId = str(body.sheet);
    const dashboardId = str(body.dashboard);
    const request = {
      filters: parseFilters(body.filters),
      parameters: parseParameterOverrides(body.parameters),
    };
    if (sheetId === null && dashboardId === null) fail(422, 'invalid');
    const targetKind = sheetId !== null ? 'sheet' : 'dashboard';
    const targetId = sheetId ?? (dashboardId as string);
    const running = await findRunning(fingerprint(user.id, kind, targetKind, targetId, request));
    if (running !== null) {
      sendJson(ctx.res, 200, publicJob(running));
      return;
    }
    if (targetKind === 'sheet') {
      await sheetAccess(ctx, targetId);
    } else {
      const record = await loadDashboardRecord(targetId);
      if (record === null) fail(404, 'not_found');
      await workbookAccess(ctx, record.workbook_id);
    }
    const job = await createJob(user, kind, targetKind, targetId, request);
    sendJson(ctx.res, 202, publicJob(job));
  });

  router.get('/api/exports/:id', async (ctx) => {
    const user = requireUser(ctx);
    const job = await loadJob(ctx.params.id);
    if (job === null || job.user_id !== user.id) fail(404, 'not_found');
    sendJson(ctx.res, 200, publicJob(job));
  });

  router.get('/api/exports/:id/events', async (ctx) => {
    const user = requireUser(ctx);
    const job = await loadJob(ctx.params.id);
    if (job === null || job.user_id !== user.id) fail(404, 'not_found');
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown): void => {
      ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('state', { status: job.status, progress: job.progress });
    if (job.status === 'ready' || job.status === 'failed') {
      send('end', { status: job.status });
      ctx.res.end();
      return;
    }
    const stop = subscribeJob(job.id, (updated) => {
      send('state', { status: updated.status, progress: updated.progress });
      if (updated.status === 'ready' || updated.status === 'failed') {
        send('end', { status: updated.status });
        stop();
        ctx.res.end();
      }
    });
    ctx.res.on('close', stop);
  });

  router.post('/api/exports/:id/retry', async (ctx) => {
    const user = requireUser(ctx);
    const job = await loadJob(ctx.params.id);
    if (job === null || job.user_id !== user.id) fail(404, 'not_found');
    if (job.status !== 'failed') fail(409, 'not_failed');
    const queued = await retryJob(job, user);
    sendJson(ctx.res, 202, publicJob(queued));
  });

  router.get('/api/exports/:id/file', async (ctx) => {
    const user = requireUser(ctx);
    const job = await loadJob(ctx.params.id);
    if (job === null || job.user_id !== user.id) fail(404, 'not_found');
    if (job.status !== 'ready' || job.object_key === null) fail(409, 'not_ready');
    try {
      const bytes = await getObject(job.object_key);
      ctx.res.writeHead(200, {
        'content-type': contentTypeOf(job.kind),
        'content-length': bytes.byteLength,
        'content-disposition': `attachment; filename="${await targetName(job)}.${extensionOf(job.kind)}"`,
      });
      ctx.res.end(Buffer.from(bytes));
    } catch {
      fail(503, 'storage_unavailable');
    }
  });
}

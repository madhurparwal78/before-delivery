import { queryOne } from '../db.js';
import type { Ctx, Reply } from '../http/router.js';
import { Router } from '../http/router.js';
import { pageStatus, type PageRow } from '../domain/pages.js';
import { findWorkspace } from '../records.js';
import { renderShell } from '../shell.js';

const html = (status: number): Reply => ({
  status,
  body: renderShell(),
  contentType: 'text/html; charset=utf-8',
});

async function workspacePage(ctx: Ctx): Promise<Reply> {
  const workspace = await findWorkspace(ctx.params.ws);
  return html(workspace === null ? 404 : 200);
}

async function publicYachtPage(ctx: Ctx): Promise<Reply> {
  const workspace = await findWorkspace(ctx.params.ws);
  if (workspace === null) return html(404);
  const yacht = await queryOne<{ status: string }>(
    'SELECT status FROM yachts WHERE workspace_id = $1 AND slug = $2',
    [workspace.id, ctx.params.yachtSlug],
  );
  if (yacht === null) return html(404);
  return html(yacht.status === 'withdrawn' ? 410 : 200);
}

async function tokenPage(ctx: Ctx, table: 'manifest_pages' | 'broker_pages'): Promise<Reply> {
  const page = await queryOne<PageRow>(`SELECT * FROM ${table} WHERE token = $1`, [ctx.params.token]);
  if (page === null) return html(404);
  return html(pageStatus(page, ctx.now) === 'live' ? 200 : 410);
}

const STAFF_PATHS = [
  '/w/:ws/today',
  '/w/:ws/fleet',
  '/w/:ws/holds',
  '/w/:ws/holds/:holdId',
  '/w/:ws/charters',
  '/w/:ws/charters/:charterId',
  '/w/:ws/passages',
  '/w/:ws/passages/new',
  '/w/:ws/passages/:passageId',
  '/w/:ws/berths',
  '/w/:ws/berth-bookings/:bookingId',
  '/w/:ws/shore-power',
  '/w/:ws/brokers',
  '/w/:ws/tariffs',
  '/w/:ws/yachts/:yachtSlug',
  '/w/:ws/yachts/:yachtSlug/profile',
  '/w/:ws/yachts/:yachtSlug/rota',
  '/w/:ws/yachts/:yachtSlug/stores',
  '/w/:ws/yachts/:yachtSlug/stores/:itemId',
  '/w/:ws/yachts/:yachtSlug/energy',
];

export function createPageRouter(): Router {
  const router = new Router();
  router.add('/sign-in', { GET: async () => html(200) });
  router.add('/fleet/:ws', { GET: workspacePage });
  router.add('/fleet/:ws/:yachtSlug', { GET: publicYachtPage });
  router.add('/m/:token', { GET: (ctx) => tokenPage(ctx, 'manifest_pages') });
  router.add('/b/:token', { GET: (ctx) => tokenPage(ctx, 'broker_pages') });
  for (const path of STAFF_PATHS) router.add(path, { GET: workspacePage });
  return router;
}

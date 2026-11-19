/** The API dispatch: one place for the error order and the route table. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, sendError, isCrossOrigin } from './http.js';
import type { Ctx } from './context.js';
import * as WS from './handlers-workshop.js';
import * as JOIN from './handlers-join.js';
import * as B from './handlers-board.js';
import * as B2 from './handlers-board2.js';
import * as BILL from './handlers-billing.js';

export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  // 1. boundary: same-origin only for state changes (DP-39)
  if (method !== 'GET' && method !== 'HEAD') {
    if (isCrossOrigin(req, ctx.cfg.publicBaseUrl)) {
      sendError(res, 403, 'cross_origin');
      return true;
    }
  }

  try {
    await dispatch(req, res, ctx, path, method, url);
  } catch (e) {
    if (e instanceof ApiError) {
      sendError(res, e.status, e.code, { message: e.message, fields: e.fields, extra: e.extra, retryAfter: e.retryAfter, rateHeaders: e.rateHeaders });
    } else {
      console.error('[api] internal error on', method, path, e);
      sendError(res, 500, 'not_found', { message: 'Internal error' });
    }
  }
  return true;
}

async function dispatch(req: IncomingMessage, res: ServerResponse, ctx: Ctx, path: string, method: string, url: URL): Promise<void> {
  // health is public and never needs a session
  if (path === '/api/health' && method === 'GET') {
    const health = await healthOf(ctx);
    // answered as ok only once Postgres is connected
    res.writeHead(ctx.ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  if (path === '/api/session') {
    if (method === 'POST') return await WS.handleSignIn(req, res, ctx);
    if (method === 'GET') return await WS.handleGetSession(req, res, ctx);
    if (method === 'DELETE') return await WS.handleSignOut(req, res, ctx);
    throw new ApiError(404, 'not_found');
  }

  const joinMatch = /^\/api\/join\/([A-Za-z0-9_-]+)$/.exec(path);
  if (joinMatch) {
    if (method === 'GET') return await JOIN.handleJoinInfo(req, res, ctx, joinMatch[1]);
    if (method === 'POST') return await JOIN.handleJoinPost(req, res, ctx, joinMatch[1]);
    throw new ApiError(404, 'not_found');
  }

  if (path === '/api/billing' && method === 'GET') return await BILL.handleBillingGet(req, res, ctx);
  if (path === '/api/billing/plan' && method === 'POST') return await BILL.handlePlanChange(req, res, ctx);
  if (path === '/api/billing/payments' && method === 'POST') return await BILL.handleRetryPayment(req, res, ctx);

  if (path === '/api/activity' && method === 'GET') return await handleActivity(req, res, ctx, url);

  if (path === '/api/workshops') {
    if (method === 'GET') return await WS.handleListWorkshops(req, res, ctx);
    if (method === 'POST') return await WS.handleCreateWorkshop(req, res, ctx);
    throw new ApiError(404, 'not_found');
  }

  const ws = /^\/api\/workshops\/([^/]+)(\/.*)?$/.exec(path);
  if (ws) {
    const workshopId = ws[1];
    const sub = (ws[2] ?? '').replace(/^\//, '');
    if (sub === '' && method === 'GET') return await WS.handleGetWorkshop(req, res, ctx, workshopId);
    if (sub === 'transitions' && method === 'POST') return await WS.handleTransition(req, res, ctx, workshopId);
    if (sub === 'join-link/rotate' && method === 'POST') return await WS.handleLinkRotate(req, res, ctx, workshopId);
    if (sub === 'join-link' && method === 'DELETE') return await WS.handleLinkOff(req, res, ctx, workshopId);
    if (sub === 'invites' && method === 'POST') return await WS.handleInvites(req, res, ctx, workshopId);
    if (sub === 'trash' && method === 'GET') return await B2.handleTrashList(req, res, ctx, workshopId);
    if (sub === 'versions' && method === 'GET') return await B2.handleVersionsList(req, res, ctx, workshopId);
    if (sub.startsWith('versions/') && sub.endsWith('/restore') && method === 'POST') {
      return await B2.handleVersionRestore(req, res, ctx, workshopId, sub.slice('versions/'.length, -'/restore'.length));
    }
    if (sub === 'recap' && method === 'GET') return await BILL.handleRecapGet(req, res, ctx, workshopId);
    if (sub === 'board' && method === 'GET') return await B.handleBoardGet(req, res, ctx, workshopId);
    if (sub === 'stream' && method === 'GET') return await B.handleStream(req, res, ctx, workshopId);
    if (sub === 'presence' && method === 'POST') return await B.handlePresence(req, res, ctx, workshopId);
    if (sub === 'search' && method === 'GET') return await B.handleSearch(req, res, ctx, workshopId);
    if (sub === 'frames' && method === 'POST') return await B.handleCreateFrame(req, res, ctx, workshopId);
    if (sub === 'images' && method === 'POST') return await B.handleImageUpload(req, res, ctx, workshopId);
    if (sub === 'notes' && method === 'POST') return await B.handleCreateNote(req, res, ctx, workshopId);
    if (sub === 'clusters' && method === 'POST') return await B2.handleCreateCluster(req, res, ctx, workshopId);
    if (sub === 'connectors' && method === 'POST') return await B2.handleCreateConnector(req, res, ctx, workshopId);
    throw new ApiError(404, 'not_found');
  }

  const frameTrash = /^\/api\/frames\/([^/]+)\/trash$/.exec(path);
  if (frameTrash && method === 'POST') return await B.handleFrameTrash(req, res, ctx, frameTrash[1]);
  const frameMatch = /^\/api\/frames\/([^/]+)$/.exec(path);
  if (frameMatch && method === 'PATCH') return await B.handleFramePatch(req, res, ctx, frameMatch[1]);
  const trashRestore = /^\/api\/trash\/([^/]+)\/restore$/.exec(path);
  if (trashRestore && method === 'POST') return await B2.handleTrashRestore(req, res, ctx, trashRestore[1]);
  const noteImage = /^\/api\/notes\/([^/]+)\/image$/.exec(path);
  if (noteImage && method === 'GET') return await B2.handleNoteImage(req, res, ctx, noteImage[1]);
  const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (noteMatch && method === 'PATCH') return await B2.handleNotePatch(req, res, ctx, noteMatch[1]);
  if (noteMatch && method === 'DELETE') return await B2.handleNoteDelete(req, res, ctx, noteMatch[1]);
  const dotsReturn = /^\/api\/clusters\/([^/]+)\/dots\/return$/.exec(path);
  if (dotsReturn && method === 'POST') return await B2.handleDotReturn(req, res, ctx, dotsReturn[1]);
  const dots = /^\/api\/clusters\/([^/]+)\/dots$/.exec(path);
  if (dots && method === 'POST') return await B2.handleDotSpend(req, res, ctx, dots[1]);
  const clusterMatch = /^\/api\/clusters\/([^/]+)$/.exec(path);
  if (clusterMatch && method === 'PATCH') return await B2.handleClusterPatch(req, res, ctx, clusterMatch[1]);
  if (clusterMatch && method === 'DELETE') return await B2.handleClusterDelete(req, res, ctx, clusterMatch[1]);
  const connectorMatch = /^\/api\/connectors\/([^/]+)$/.exec(path);
  if (connectorMatch && method === 'DELETE') return await B2.handleConnectorDelete(req, res, ctx, connectorMatch[1]);

  const recapFile = /^\/api\/recaps\/([^/]+)\/files\/([^/]+)$/.exec(path);
  if (recapFile && method === 'GET') return await BILL.handleRecapFile(req, res, ctx, recapFile[1], decodeURIComponent(recapFile[2]));
  const recapMatch = /^\/api\/recaps\/([^/]+)$/.exec(path);
  if (recapMatch && method === 'GET') return await BILL.handleRecapPublic(req, res, ctx, recapMatch[1]);

  throw new ApiError(404, 'not_found');
}

async function handleActivity(req: IncomingMessage, res: ServerResponse, ctx: Ctx, url: URL): Promise<void> {
  const { requireFacilitator, readJsonBody } = await import('./context.js');
  void readJsonBody;
  const fac = await requireFacilitator(req, ctx.db);
  const cursor = url.searchParams.get('cursor');
  let limit = 20;
  const limitRaw = url.searchParams.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new ApiError(422, 'validation', { fields: { limit: 'Check this value' } });
    }
    limit = n;
  }
  let beforeSeq: string | null = null;
  if (cursor) {
    const row = await ctx.db.row<{ seq: string }>('select seq from activity where id = $1 and facilitator_id = $2', [cursor, fac.id]);
    if (!row) throw new ApiError(422, 'validation', { fields: { cursor: "That cursor isn't valid" } });
    beforeSeq = row.seq;
  }
  const rows = await ctx.db.rows<{ id: string; seq: string; at: Date; actor: string; action: string; workshop_id: string | null }>(
    `select * from activity where facilitator_id = $1 ${beforeSeq !== null ? 'and seq < $2' : ''} order by seq desc limit ${limit + 1}`,
    beforeSeq !== null ? [fac.id, beforeSeq] : [fac.id]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    entries: page.map((r) => ({
      id: r.id, seq: Number(r.seq), at: r.at.toISOString(), actor: r.actor,
      action: r.action, workshopId: r.workshop_id,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  }));
}

async function healthOf(ctx: Ctx): Promise<Record<string, unknown>> {
  let dbUp = false;
  try {
    await ctx.db.exec('select 1');
    dbUp = true;
  } catch { /* down */ }
  let kbUp = false;
  try {
    await ctx.kb.ensureTenantAndCatalog();
    kbUp = true;
  } catch { /* down */ }
  let minioUp = false;
  try {
    await ctx.s3.ensureBucket();
    minioUp = true;
  } catch { /* down */ }
  const mailUp = await (await import('./mail.js')).probeTcp(ctx.cfg.smtp.host, ctx.cfg.smtp.port);
  return {
    status: 'ok',
    instance: ctx.cfg.instanceId,
    db: dbUp ? 'up' : 'down',
    killbill: kbUp ? 'up' : 'down',
    minio: minioUp ? 'up' : 'down',
    mailpit: mailUp ? 'up' : 'down',
  };
}

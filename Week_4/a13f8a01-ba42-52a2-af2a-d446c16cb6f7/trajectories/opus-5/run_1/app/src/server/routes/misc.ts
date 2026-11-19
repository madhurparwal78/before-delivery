import type { ClientConfig } from '../../shared/api';
import { config } from '../config';
import { databaseHealthy, one, query } from '../db';
import { requireFiles, requireLibraries } from '../domain/validate';
import { findPen, requireVersion, visibleTo } from '../domain/pens';
import { apiError } from '../errors';
import { subscribe } from '../events';
import { HANDLED, json, type Ctx, type Reply, type Router } from '../http';
import { mailHealthy } from '../mail';
import { previewDocument, PREVIEW_CSP } from '../preview';
import { shelf, shelfEntries } from '../shelf';
import { storageHealthy } from '../storage';
import { newId, newToken } from '../util';

const RENDER_LIFETIME = '2 hours';

interface RenderRow {
  id: string;
  nonce: string;
  html: string;
  css: string;
  js: string;
  libraries: string[];
}

const health = async (): Promise<Reply> => {
  const [database, storage, mail] = await Promise.all([
    databaseHealthy(),
    storageHealthy(),
    mailHealthy(),
  ]);
  return json(200, { status: database && storage && mail ? 'ok' : 'unavailable' });
};

const clientConfig = async (): Promise<Reply> => {
  const body: ClientConfig = {
    preview_delay_ms: config.previewDelayMs,
    draft_interval_ms: config.draftIntervalMs,
    search_debounce_ms: config.searchDebounceMs,
    loop_limit: config.loopLimit,
    pane_limit_bytes: config.paneLimitBytes,
    max_tags: config.maxTags,
    live_poll_ms: 1000,
  };
  return json(200, body);
};

const shelfList = async (): Promise<Reply> => json(200, { libraries: shelfEntries() });

const createRender = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const id = newId();
  const nonce = newToken();

  if (typeof body.pen_id === 'string') {
    const pen = await findPen(body.pen_id);
    if (!pen || !visibleTo(pen, ctx.user?.id ?? null)) throw apiError('not_found');
    const number = body.version === undefined ? pen.head : Number(body.version);
    if (!Number.isInteger(number)) throw apiError('not_found');
    const version = await requireVersion(pen.id, number);
    await query(
      `insert into renders (id, nonce, html, css, js, libraries, pen_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, nonce, version.html, version.css, version.js, version.libraries, pen.id],
    );
  } else {
    const files = requireFiles(body);
    const libraries = requireLibraries(body.libraries ?? []);
    await query(
      `insert into renders (id, nonce, html, css, js, libraries) values ($1, $2, $3, $4, $5, $6)`,
      [id, nonce, files.html, files.css, files.js, libraries],
    );
  }

  return json(201, { render: id, nonce, url: `/preview/${id}` });
};

const previewPage = async (ctx: Ctx): Promise<Reply> => {
  const row = await one<RenderRow>(
    `select id, nonce, html, css, js, libraries from renders
      where id = $1 and created_at > now() - interval '${RENDER_LIFETIME}'`,
    [ctx.params.id!],
  );
  if (!row) {
    return { status: 404, raw: 'Nothing here.', contentType: 'text/plain; charset=utf-8' };
  }
  return {
    status: 200,
    raw: previewDocument({
      id: row.id,
      nonce: row.nonce,
      files: { html: row.html, css: row.css, js: row.js },
      libraries: row.libraries,
    }),
    contentType: 'text/html; charset=utf-8',
    headers: { 'content-security-policy': PREVIEW_CSP, 'cache-control': 'no-store' },
  };
};

const shelfFile = async (ctx: Ctx): Promise<Reply> => {
  const library = shelf.find(
    (candidate) => candidate.entry.id === ctx.params.id && candidate.file === ctx.params.file,
  );
  if (!library) {
    return { status: 404, raw: 'Nothing here.', contentType: 'text/plain; charset=utf-8' };
  }
  return {
    status: 200,
    raw: library.body,
    contentType: 'text/javascript; charset=utf-8',
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  };
};

const events = async (ctx: Ctx): Promise<Reply> => {
  const requested = (ctx.url.searchParams.get('pens') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const viewerId = ctx.user?.id ?? null;
  const visible: string[] = [];
  for (const id of requested) {
    const pen = await findPen(id);
    if (pen && visibleTo(pen, viewerId)) visible.push(id);
  }

  ctx.response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  ctx.response.write(': open\n\n');
  const unsubscribe = subscribe(ctx.response, visible, viewerId);
  ctx.request.on('close', unsubscribe);
  return HANDLED;
};

export const registerMiscRoutes = (router: Router): void => {
  router.add('GET', '/api/health', health);
  router.add('GET', '/api/config', clientConfig);
  router.add('GET', '/api/shelf', shelfList);
  router.add('POST', '/api/renders', createRender);
  router.add('GET', '/api/events', events);
  router.add('GET', '/preview/:id', previewPage);
  router.add('GET', '/shelf/:id/:file', shelfFile);
};

export const cleanUpRenders = async (): Promise<void> => {
  await query(`delete from renders where created_at < now() - interval '${RENDER_LIFETIME}'`);
};

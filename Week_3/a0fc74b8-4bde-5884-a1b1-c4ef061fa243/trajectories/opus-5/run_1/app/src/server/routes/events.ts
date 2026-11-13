import { callerOf } from '../auth.ts';
import { notFound, unauthenticated } from '../http/errors.ts';
import type { Ctx, HttpApp } from '../http/server.ts';
import { health } from '../services/health.ts';
import type { DocumentFilter } from '../../shared/types.ts';
import { documentJson, listDocuments, loadAggregate } from '../model/document.ts';
import { resolveLink } from '../model/flow.ts';
import { listTemplatesForTeam } from '../model/template.ts';
import { signViewJson } from './signView.ts';

const TICK_MS = 1000;
const PING_MS = 15000;

const readFilter = (raw: string | null): DocumentFilter =>
  raw === 'in_progress' || raw === 'completed' || raw === 'closed' ? raw : 'all';

const buildPayload = async (ctx: Ctx): Promise<Record<string, unknown>> => {
  const scope = ctx.url.searchParams.get('scope') ?? 'documents';
  const now = new Date();
  if (scope === 'sign') {
    const token = ctx.url.searchParams.get('token') ?? '';
    const context = await resolveLink(token, undefined, now);
    if (context === null) return { view: null };
    return { view: signViewJson(context, now) };
  }
  const caller = await callerOf(ctx);
  if (!caller) throw unauthenticated();
  const base: Record<string, unknown> = {
    role: caller.role,
    notice: health(),
  };
  if (scope === 'document') {
    const id = ctx.url.searchParams.get('id') ?? '';
    const aggregate = await loadAggregate(id, caller.teamId);
    base['document'] = aggregate === null ? null : documentJson(aggregate, now);
    return base;
  }
  if (scope === 'templates') {
    base['templates'] = await listTemplatesForTeam(caller.teamId, caller.role !== 'owner');
    return base;
  }
  if (scope === 'documents') {
    base['documents'] = await listDocuments(
      caller.teamId,
      readFilter(ctx.url.searchParams.get('filter')),
      now,
    );
    return base;
  }
  return base;
};

/**
 * One same-origin live channel. The server recomputes the page's state each
 * tick and pushes it only when it changed, so changes from another instance
 * sharing the database arrive too.
 */
export const registerEventRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/events', async (ctx) => {
    const scope = ctx.url.searchParams.get('scope') ?? 'documents';
    if (scope === 'sign' && (ctx.url.searchParams.get('token') ?? '') === '') throw notFound();
    const first = await buildPayload(ctx);

    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let last = JSON.stringify(first);
    ctx.res.write(`data: ${last}\n\n`);

    let busy = false;
    const tick = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const payload = JSON.stringify(await buildPayload(ctx));
          if (payload !== last) {
            last = payload;
            ctx.res.write(`data: ${payload}\n\n`);
          }
        } catch {
          clearInterval(tick);
          ctx.res.end();
        } finally {
          busy = false;
        }
      })();
    }, TICK_MS);
    const ping = setInterval(() => ctx.res.write(': ping\n\n'), PING_MS);

    const stop = (): void => {
      clearInterval(tick);
      clearInterval(ping);
    };
    ctx.req.on('close', stop);
    ctx.res.on('close', stop);
  });
};

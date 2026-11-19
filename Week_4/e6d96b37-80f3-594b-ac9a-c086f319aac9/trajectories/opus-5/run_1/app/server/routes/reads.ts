import { limits, publicLimits } from '../config.ts';
import { db } from '../providers/db.ts';
import { getObject } from '../providers/storage.ts';
import { KeycloakDown, isIdentityLive } from '../providers/keycloak.ts';
import { namespaceNow } from '../domain/clock.ts';
import { rowMajorCompare } from '../domain/holder.ts';
import { fieldCopy, notFound } from '../http/errors.ts';
import { authorizeRead } from '../http/precedence.ts';
import { sendJson } from '../http/request.ts';
import type { Router } from '../http/router.ts';
import { loadDesk } from '../store/state.ts';
import { appendEvent, publish, subscribe } from '../store/events.ts';
import { destroySessionsOfSubject } from '../session.ts';
import { deskVisibleTo, parseLimit } from './common.ts';
import type { DeskEvent } from '../../shared/types.ts';

export function registerReadRoutes(router: Router): void {
  router.add({
    method: 'GET',
    path: '/api/desks/:ns/state',
    handler: async ({ response, params, session }) => {
      const ns = params['ns'] as string;
      const viewer = await authorizeRead({
        session,
        visible: () => deskVisibleTo(session, ns),
        permitted: () => true,
      });
      const { state } = await loadDesk(ns, viewer.role);
      sendJson(response, 200, state);
    },
  });

  /** The browser's own copy of the limits it must honour. */
  router.add({
    method: 'GET',
    path: '/api/limits',
    handler: async ({ response }) => {
      sendJson(response, 200, publicLimits);
    },
  });

  router.add({
    method: 'GET',
    path: '/api/desks/:ns/specimens',
    dealerOnly: true,
    handler: async ({ response, params, url, session }) => {
      const ns = params['ns'] as string;
      const viewer = await authorizeRead({
        session,
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
      });
      const limit = parseLimit(url.searchParams.get('limit'), limits.pageMax, fieldCopy.pageLimit);
      const after = url.searchParams.get('after');

      const { specimensInOrder } = await loadDesk(ns, viewer.role);
      const sql = await db();
      const sequences = await sql.query<{ key: string; created_seq: string }>(
        'SELECT key, created_seq FROM specimens WHERE ns = $1',
        [ns],
      );
      const sequenceOf = new Map(sequences.rows.map((row) => [row.key, Number(row.created_seq)]));

      // The cursor is a creation sequence, so moving holders between cells
      // never changes order and no item repeats or is skipped across pages.
      const cursor = after === null || after === '' ? null : Number.parseInt(after, 10);
      const remaining = specimensInOrder.filter(
        (item) => cursor === null || (sequenceOf.get(item.key) ?? 0) > cursor,
      );
      const page = remaining.slice(0, limit);
      const last = page[page.length - 1];
      const next =
        page.length === limit && remaining.length > limit && last
          ? String(sequenceOf.get(last.key) ?? '')
          : null;
      sendJson(response, 200, { items: page, next });
    },
  });

  router.add({
    method: 'GET',
    path: '/api/desks/:ns/audit/cells',
    dealerOnly: true,
    handler: async ({ response, params, url, session }) => {
      const ns = params['ns'] as string;
      const viewer = await authorizeRead({
        session,
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
      });
      const limit = parseLimit(url.searchParams.get('limit'), limits.pageMax, fieldCopy.pageLimit);
      const after = url.searchParams.get('after');

      const { cellsInOrder } = await loadDesk(ns, viewer.role);
      const ordered = [...cellsInOrder].sort(rowMajorCompare);
      // The cursor is the last item's cell coordinate, and each cell appears
      // exactly once across pages.
      const start = after ? ordered.findIndex((cell) => cell.cell === after) + 1 : 0;
      const page = ordered.slice(start, start + limit);
      const last = page[page.length - 1];
      const next = start + limit < ordered.length && last ? last.cell : null;
      sendJson(response, 200, {
        items: page.map((cell) => ({
          cell: cell.cell,
          specimen: cell.specimen,
          audit_mark: cell.audit_mark,
          audit_version: cell.audit_version,
        })),
        next,
      });
    },
  });

  router.add({
    method: 'GET',
    path: '/api/desks/:ns/photos/:photo',
    handler: async ({ response, params, session }) => {
      const ns = params['ns'] as string;
      const photoId = params['photo'] as string;
      const viewer = await authorizeRead({
        session,
        visible: () => deskVisibleTo(session, ns),
        permitted: () => true,
      });

      const { state, photoById } = await loadDesk(ns, viewer.role);
      const photo = photoById.get(photoId);
      if (!photo) throw notFound();
      // A counterpart may only read the photographs of specimens they can see.
      const owner = Object.entries(state.specimens).find(([key]) => key === photo.specimen);
      if (!owner) throw notFound();

      const stored = await getObject(photo.object_key);
      if (!stored) throw notFound();
      response.writeHead(200, {
        'content-type': photo.content_type,
        'content-length': String(stored.body.length),
        'cache-control': 'no-store',
      });
      response.end(stored.body);
    },
  });

  router.add({
    method: 'GET',
    path: '/evidence/:token',
    handler: async ({ response, params, session }) => {
      const token = params['token'] as string;
      if (!session) throw notFound();
      const sql = await db();
      const found = await sql.query<{ ns: string; dispute: string; expires_at: Date; revoked: boolean }>(
        'SELECT ns, dispute, expires_at, revoked FROM evidence_links WHERE token = $1',
        [token],
      );
      const link = found.rows[0];
      // Any other caller, or an expired or revoked token, is simply not found.
      if (!link || link.revoked) throw notFound();
      if (link.ns !== session.ns || session.role === 'outsider') throw notFound();

      const now = await namespaceNow(sql, link.ns);
      if (link.expires_at.getTime() <= now.getTime()) throw notFound();

      const { state, photoById } = await loadDesk(link.ns, session.role);
      const dispute = state.disputes[link.dispute];
      if (!dispute) throw notFound();

      const arrival = [...photoById.values()].find(
        (photo) => photo.specimen === dispute.specimen && photo.label === 'arrival',
      );
      if (!arrival) throw notFound();
      const stored = await getObject(arrival.object_key);
      if (!stored) throw notFound();
      response.writeHead(200, {
        'content-type': arrival.content_type,
        'content-length': String(stored.body.length),
        'cache-control': 'no-store',
      });
      response.end(stored.body);
    },
  });

  router.add({
    method: 'GET',
    path: '/api/desks/:ns/stream',
    handler: async ({ request, response, params, url, session }) => {
      const ns = params['ns'] as string;
      const viewer = await authorizeRead({
        session,
        visible: () => deskVisibleTo(session, ns),
        permitted: () => true,
      });

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const write = (event: { sequence: number } & Record<string, unknown>): void => {
        response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const headerId = request.headers['last-event-id'];
      const afterRaw = url.searchParams.get('after') ?? (typeof headerId === 'string' ? headerId : null);
      const after = afterRaw === null ? null : Number.parseInt(afterRaw, 10);

      // Replay everything after the cursor in sequence order, then stream live.
      if (after !== null && Number.isFinite(after)) {
        const sql = await db();
        const missed = await sql.query<{
          command_id: string | null;
          actor: string;
          type: string;
          sequence: string;
          at: Date;
        }>(
          `SELECT command_id, actor, type, sequence, at FROM desk_events
            WHERE ns = $1 AND sequence > $2 ORDER BY sequence`,
          [ns, after],
        );
        for (const row of missed.rows) {
          const event: DeskEvent = {
            command_id: row.command_id,
            actor: row.actor as DeskEvent['actor'],
            type: row.type as DeskEvent['type'],
            sequence: Number(row.sequence),
            at: row.at.toISOString(),
          };
          write({ ...event });
        }
      }

      const unsubscribe = subscribe(ns, (event) => write({ ...event }));
      const beat = setInterval(() => response.write(': keep-alive\n\n'), 15_000);

      // Every streaming counterpart is re-checked at least once per live bound.
      const recheck =
        viewer.role === 'counterpart' && !viewer.bypassKeycloak
          ? setInterval(() => {
              void (async () => {
                let live = true;
                try {
                  live = await isIdentityLive(viewer.subject, viewer.kcSession);
                } catch (error) {
                  if (error instanceof KeycloakDown) return;
                  throw error;
                }
                if (live) return;
                await destroySessionsOfSubject(viewer.subject);
                const ended = await appendEvent(await db(), ns, {
                  type: 'access.ended',
                  actor: 'system',
                  commandId: null,
                  payload: { subject: viewer.subject },
                });
                publish(ns, [ended]);
                close();
              })();
            }, limits.liveMs)
          : null;

      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        if (recheck) clearInterval(recheck);
        unsubscribe();
        response.end();
      };

      request.on('close', close);
      request.on('error', close);
      response.on('error', close);
    },
  });
}

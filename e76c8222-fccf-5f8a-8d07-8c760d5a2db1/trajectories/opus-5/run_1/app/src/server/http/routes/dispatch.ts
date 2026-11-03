import { Router } from 'express';
import { AuditEntry, BoardInterpreter, CredentialType, Role } from '../../../shared/types';
import { agencyDateOf, toIsoWithOffset } from '../../../shared/time';
import { pool, query } from '../../db/pool';
import { dryRunSeat, pinSeat } from '../../domain/dispatch';
import { answerOffer, offerPage } from '../../domain/offers';
import { listRequestRows, serializeRequests } from '../../domain/requests';
import { jsonObject, pathParam, requireRoles } from '../context';
import { notFound, validationFailed } from '../errors';
import { kickOutbox } from '../../jobs/background';

export const dispatchRouter = Router();

function readInterpreterId(body: Record<string, unknown>): string {
  const id = typeof body.interpreter_id === 'string' ? body.interpreter_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  return id;
}

dispatchRouter.get('/board', async (req, res) => {
  requireRoles(req, ['coordinator']);
  const now = new Date();
  const rows = await listRequestRows(pool, {
    order: 'start_asc',
    withinHours: 72,
    excludeCancelled: true,
  });
  const credentialRows = await query<{
    interpreter_id: string;
    interpreter_name: string;
    id: string | null;
    type: CredentialType | null;
    expires_on: string | null;
  }>(
    pool,
    `select u.id as interpreter_id, u.name as interpreter_name,
            c.id, c.type, c.expires_on
     from users u
     left join credentials c on c.interpreter_id = u.id
     where u.role = 'interpreter'
     order by u.name, c.expires_on desc`,
  );
  const today = agencyDateOf(now);
  const interpreters: BoardInterpreter[] = [];
  for (const row of credentialRows) {
    let interpreter = interpreters.find((item) => item.id === row.interpreter_id);
    if (!interpreter) {
      interpreter = { id: row.interpreter_id, name: row.interpreter_name, credentials: [] };
      interpreters.push(interpreter);
    }
    if (row.id && row.type && row.expires_on) {
      interpreter.credentials.push({
        id: row.id,
        type: row.type,
        expires_on: row.expires_on,
        expired: row.expires_on < today,
      });
    }
  }
  res.json({ interpreters, requests: await serializeRequests(pool, rows, now) });
});

dispatchRouter.post('/seats/:seatId/dry-run', async (req, res) => {
  requireRoles(req, ['coordinator']);
  const interpreterId = readInterpreterId(jsonObject(req));
  res.json(await dryRunSeat(pathParam(req, 'seatId'), interpreterId, new Date()));
});

dispatchRouter.post('/seats/:seatId/offers', async (req, res) => {
  const user = requireRoles(req, ['coordinator']);
  const interpreterId = readInterpreterId(jsonObject(req));
  const result = await pinSeat(pathParam(req, 'seatId'), interpreterId, user.id, new Date());
  kickOutbox();
  res.status(201).json(result);
});

dispatchRouter.get('/offers/:token', async (req, res) => {
  const page = await offerPage(pool, pathParam(req, 'token'), new Date());
  if (!page) throw notFound();
  res.json(page);
});

dispatchRouter.post('/offers/:token/accept', async (req, res) => {
  const result = await answerOffer(pathParam(req, 'token'), 'accept', new Date());
  kickOutbox();
  res.json({
    offer: { status: result.offerStatus },
    request: { ref: result.ref, status: result.requestStatus },
  });
});

dispatchRouter.post('/offers/:token/decline', async (req, res) => {
  const result = await answerOffer(pathParam(req, 'token'), 'decline', new Date());
  res.json({
    offer: { status: result.offerStatus },
    request: { ref: result.ref, status: result.requestStatus },
  });
});

dispatchRouter.get('/audit', async (req, res) => {
  requireRoles(req, ['coordinator', 'billing']);
  const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : null;
  if (requestId !== null && !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw validationFailed({ request_id: 'Give a request id.' });
  }
  const rows = await query<{
    at: Date;
    actor_id: string | null;
    actor_name: string | null;
    actor_role: Role | null;
    action: string;
    entity: string;
    entity_id: string;
    from_status: string | null;
    to_status: string | null;
    detail: Record<string, unknown>;
  }>(
    pool,
    `select a.at, a.actor_id, u.name as actor_name, u.role as actor_role, a.action, a.entity,
            a.entity_id, a.from_status, a.to_status, a.detail
     from audit_entries a
     left join users u on u.id = a.actor_id
     ${requestId ? 'where a.request_id = $1' : ''}
     order by a.id asc`,
    requestId ? [requestId] : [],
  );
  const entries: AuditEntry[] = rows.map((row) => ({
    at: toIsoWithOffset(row.at),
    actor:
      row.actor_id && row.actor_name && row.actor_role
        ? { id: row.actor_id, name: row.actor_name, role: row.actor_role }
        : null,
    action: row.action,
    entity: row.entity,
    entity_id: row.entity_id,
    from: row.from_status,
    to: row.to_status,
    detail: row.detail,
  }));
  res.json({ entries });
});

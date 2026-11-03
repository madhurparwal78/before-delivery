import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { RequestStatus } from '../../../shared/types';
import { pool, query, queryOne, withTransaction } from '../../db/pool';
import { writeAudit } from '../../domain/audit';
import { cancelRequest, guardCancellable, quoteFor } from '../../domain/cancellation';
import { runIdempotent } from '../../domain/idempotency';
import { readIdempotencyKey } from '../../domain/idempotency';
import { preferencesOf } from '../../domain/preferences';
import {
  applySeatPlan,
  listRequestRows,
  loadRequestRow,
  nextRequestRef,
  serializeRequest,
  serializeRequests,
} from '../../domain/requests';
import { PREP_UPLOAD_STATUSES, durationMinutesOf } from '../../domain/rules';
import { getObject, prepObjectKey, putObject } from '../../services/storage';
import { AuthUser, jsonObject, pathParam, requireAuth, requireRoles } from '../context';
import { fail, invalidTransition, notFound, validationFailed } from '../errors';
import { PREP_TYPES, readMultipart, resolveContentType, singleFile } from '../upload';
import { readRequestInput } from '../validation';

export const requestsRouter = Router();

const STAFF_ROLES = ['coordinator', 'billing'] as const;

async function visibleRequestRow(user: AuthUser, id: string) {
  const row = await loadRequestRow(pool, id);
  if (!row) throw notFound();
  if (user.role === 'requester' && row.org_id !== user.org_id) throw notFound();
  return row;
}

requestsRouter.get('/requests', async (req, res) => {
  const user = requireRoles(req, ['requester', ...STAFF_ROLES]);
  const now = new Date();
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await listRequestRows(pool, {
    orgId: user.role === 'requester' && user.org_id ? user.org_id : undefined,
    status: statusFilter as RequestStatus | undefined,
    order: 'start_desc',
  });
  res.json({ requests: await serializeRequests(pool, rows, now) });
});

requestsRouter.post('/requests', async (req, res) => {
  const user = requireAuth(req);
  const body = jsonObject(req);
  const now = new Date();
  const loggedAfter = body.logged_after === true;

  let orgId: string;
  if (user.role === 'requester' && user.org_id) {
    if (loggedAfter) throw fail('forbidden');
    orgId = user.org_id;
  } else if (user.role === 'coordinator') {
    if (!loggedAfter) throw fail('forbidden');
    const requested = typeof body.org_id === 'string' ? body.org_id : '';
    const org = await queryOne<{ id: string }>(pool, 'select id from orgs where id = $1', [
      requested,
    ]);
    if (!org) throw validationFailed({ org_id: 'Choose a requesting organisation.' });
    orgId = org.id;
  } else {
    throw fail('forbidden');
  }

  const input = await readRequestInput(pool, body, { partial: false, loggedAfter, now });
  const id = randomUUID();
  const created = await withTransaction(async (client) => {
    const ref = await nextRequestRef(client);
    const status: RequestStatus = loggedAfter ? 'submitted' : 'draft';
    await client.query(
      `insert into requests
         (id, ref, org_id, title, setting, location, start_at, end_at, consumer_id, notes,
          status, logged_after, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        ref,
        orgId,
        input.title,
        input.setting,
        input.location,
        input.start,
        input.end,
        input.consumer_id,
        input.notes ?? '',
        status,
        loggedAfter,
        user.id,
      ],
    );
    const inserted = await loadRequestRow(client, id);
    if (!inserted) throw notFound();
    await applySeatPlan(
      client,
      id,
      inserted.setting,
      durationMinutesOf(inserted.start_at, inserted.end_at),
    );
    await writeAudit(client, {
      actorId: user.id,
      action: 'request.created',
      entity: 'request',
      entityId: id,
      requestId: id,
      to: status,
      detail: { ref, logged_after: loggedAfter },
    });
    return id;
  });

  const row = await loadRequestRow(pool, created);
  if (!row) throw notFound();
  res.status(201).json({ request: await serializeRequest(pool, row, now) });
});

requestsRouter.get('/requests/:id', async (req, res) => {
  const user = requireRoles(req, ['requester', ...STAFF_ROLES]);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  res.json({ request: await serializeRequest(pool, row, new Date()) });
});

requestsRouter.patch('/requests/:id', async (req, res) => {
  const user = requireRoles(req, ['requester']);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  if (row.status !== 'draft') throw invalidTransition(row.status);
  const now = new Date();
  const input = await readRequestInput(pool, jsonObject(req), {
    partial: true,
    loggedAfter: false,
    now,
    current: { start: row.start_at, end: row.end_at },
  });

  await withTransaction(async (client) => {
    await client.query(
      `update requests set
         title = coalesce($2, title), setting = coalesce($3, setting),
         location = coalesce($4, location), start_at = coalesce($5, start_at),
         end_at = coalesce($6, end_at), consumer_id = coalesce($7, consumer_id),
         notes = coalesce($8, notes)
       where id = $1`,
      [
        row.id,
        input.title ?? null,
        input.setting ?? null,
        input.location ?? null,
        input.start ?? null,
        input.end ?? null,
        input.consumer_id ?? null,
        input.notes ?? null,
      ],
    );
    const updated = await loadRequestRow(client, row.id);
    if (!updated) throw notFound();
    await applySeatPlan(
      client,
      row.id,
      updated.setting,
      durationMinutesOf(updated.start_at, updated.end_at),
    );
    await writeAudit(client, {
      actorId: user.id,
      action: 'request.updated',
      entity: 'request',
      entityId: row.id,
      requestId: row.id,
      from: 'draft',
      to: 'draft',
      detail: { fields: Object.keys(input) },
    });
  });

  const updated = await loadRequestRow(pool, row.id);
  if (!updated) throw notFound();
  res.json({ request: await serializeRequest(pool, updated, now) });
});

requestsRouter.post('/requests/:id/submit', async (req, res) => {
  const user = requireRoles(req, ['requester']);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  if (row.status !== 'draft') throw invalidTransition(row.status);
  const now = new Date();
  if (row.start_at.getTime() <= now.getTime()) {
    throw validationFailed({ start: 'Start must be in the future.' });
  }
  await withTransaction(async (client) => {
    await client.query(`update requests set status = 'submitted' where id = $1`, [row.id]);
    await writeAudit(client, {
      actorId: user.id,
      action: 'request.submitted',
      entity: 'request',
      entityId: row.id,
      requestId: row.id,
      from: 'draft',
      to: 'submitted',
    });
  });
  const updated = await loadRequestRow(pool, row.id);
  if (!updated) throw notFound();
  res.json({ request: await serializeRequest(pool, updated, now) });
});

requestsRouter.post('/requests/:id/prep', async (req, res) => {
  const user = requireRoles(req, ['requester']);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  const now = new Date();
  const request = await serializeRequest(pool, row, now);
  if (!PREP_UPLOAD_STATUSES.includes(request.status)) throw invalidTransition(request.status);

  const multipart = await readMultipart(req);
  const file = singleFile(multipart, 'file');
  const contentType = resolveContentType(file, PREP_TYPES);
  const id = randomUUID();
  const key = prepObjectKey(row.org_id, row.id, id, file.filename);
  await putObject(key, file.bytes, contentType);
  await pool.query(
    `insert into prep_files (id, request_id, org_id, filename, size, content_type, object_key)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, row.id, row.org_id, file.filename, file.bytes.length, contentType, key],
  );
  res.status(201).json({
    file: { id, filename: file.filename, size: file.bytes.length, content_type: contentType },
  });
});

requestsRouter.get('/prep/:fileId', async (req, res) => {
  const user = requireAuth(req);
  const fileId = pathParam(req, 'fileId');
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound();
  const file = await queryOne<{
    request_id: string;
    org_id: string;
    filename: string;
    content_type: string;
    object_key: string;
    request_status: RequestStatus;
  }>(
    pool,
    `select p.request_id, p.org_id, p.filename, p.content_type, p.object_key,
            r.status as request_status
     from prep_files p join requests r on r.id = p.request_id
     where p.id = $1`,
    [fileId],
  );
  if (!file) throw notFound();

  const cancelled =
    file.request_status === 'cancelled_late' || file.request_status === 'cancelled_on_time';
  let allowed = false;
  if (user.role === 'coordinator' || user.role === 'billing') {
    allowed = true;
  } else if (user.role === 'requester') {
    allowed = user.org_id === file.org_id;
  } else if (user.role === 'interpreter' && !cancelled) {
    const seated = await queryOne<{ ok: boolean }>(
      pool,
      `select true as ok from seats s
       join offers o on o.seat_id = s.id and o.status = 'accepted'
       where s.request_id = $1 and o.interpreter_id = $2`,
      [file.request_id, user.id],
    );
    allowed = seated !== null;
  }
  if (!allowed) throw notFound();

  const object = await getObject(file.object_key);
  res.setHeader('Content-Type', file.content_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(object.body);
});

requestsRouter.get('/requests/:id/cancellation-quote', async (req, res) => {
  const user = requireRoles(req, ['requester', 'coordinator']);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  const now = new Date();
  const request = await serializeRequest(pool, row, now);
  guardCancellable(request, now);
  const quote = await quoteFor(pool, row, request, now);
  res.json({ quote: quote.quote });
});

requestsRouter.post('/requests/:id/cancel', async (req, res) => {
  const user = requireRoles(req, ['requester', 'coordinator']);
  const row = await visibleRequestRow(user, pathParam(req, 'id'));
  const key = readIdempotencyKey(req.headers['idempotency-key']);
  const body = jsonObject(req);
  const expectedFee = typeof body.expected_fee === 'string' ? body.expected_fee : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';

  const outcome = await runIdempotent(
    { userId: user.id, action: 'cancel', targetId: row.id, key, body },
    async () => {
      const now = new Date();
      const request = await serializeRequest(pool, row, now);
      const result = await cancelRequest({
        row,
        request,
        actorId: user.id,
        expectedFee,
        reason,
        now,
      });
      return { status: 200, body: result };
    },
  );
  if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(outcome.status).json(outcome.body);
});

requestsRouter.get('/consumers', async (req, res) => {
  requireRoles(req, ['requester', 'coordinator']);
  const consumers = await query<{ id: string; name: string }>(
    pool,
    `select id, name from users where role = 'consumer' order by name`,
  );
  res.json({ consumers });
});

requestsRouter.get('/consumers/:id/preferences', async (req, res) => {
  requireRoles(req, ['coordinator']);
  const id = pathParam(req, 'id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const consumer = await queryOne<{ id: string; name: string }>(
    pool,
    `select id, name from users where id = $1 and role = 'consumer'`,
    [id],
  );
  if (!consumer) throw notFound();
  const lists = await preferencesOf(pool, consumer.id);
  res.json({ consumer, ...lists });
});

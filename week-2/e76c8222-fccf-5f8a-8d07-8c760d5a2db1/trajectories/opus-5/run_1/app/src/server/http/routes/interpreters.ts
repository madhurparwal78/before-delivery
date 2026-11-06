import { Router } from 'express';
import { pool, query } from '../../db/pool';
import { addCredential, listCredentials, loadScan } from '../../domain/credentials';
import { readIdempotencyKey, runIdempotent } from '../../domain/idempotency';
import { listMyOffers } from '../../domain/offers';
import { RequestRow, serializeRequests } from '../../domain/requests';
import { submitTimesheet } from '../../domain/timesheets';
import { getObject } from '../../services/storage';
import { jsonObject, pathParam, requireAuth, requireRoles } from '../context';
import { notFound } from '../errors';
import { SCAN_TYPES, readMultipart, resolveContentType, singleFile } from '../upload';
import { readCredentialInput, readTimesheetInput } from '../validation';

export const interpretersRouter = Router();

interpretersRouter.get('/interpreters/me/assignments', async (req, res) => {
  const user = requireRoles(req, ['interpreter']);
  const now = new Date();
  const rows = await query<RequestRow>(
    pool,
    `select r.id, r.ref, r.org_id, g.name as org_name, r.title, r.setting, r.location,
            r.start_at, r.end_at, r.consumer_id, c.name as consumer_name, r.notes, r.status,
            r.logged_after, r.cancellation_fee_cents, r.cancellation_quote
     from requests r
     join orgs g on g.id = r.org_id
     join users c on c.id = r.consumer_id
     join seats s on s.request_id = r.id
     join offers o on o.seat_id = s.id and o.status = 'accepted'
     where o.interpreter_id = $1
       and r.status not in ('cancelled_on_time', 'cancelled_late')
     order by r.start_at asc`,
    [user.id],
  );
  res.json({
    offers: await listMyOffers(pool, user.id, now),
    assignments: await serializeRequests(pool, rows, now),
  });
});

interpretersRouter.post('/seats/:seatId/timesheet', async (req, res) => {
  const user = requireRoles(req, ['interpreter']);
  const seatId = pathParam(req, 'seatId');
  const key = readIdempotencyKey(req.headers['idempotency-key']);
  const body = jsonObject(req);
  const input = readTimesheetInput(body);
  const outcome = await runIdempotent(
    { userId: user.id, action: 'timesheet.submit', targetId: seatId, key, body },
    async () => {
      const timesheet = await submitTimesheet({
        seatId,
        interpreterId: user.id,
        actualStart: input.actualStart,
        actualEnd: input.actualEnd,
        signatureName: input.signatureName,
        now: new Date(),
      });
      return { status: 201, body: { timesheet } };
    },
  );
  if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(outcome.status).json(outcome.body);
});

interpretersRouter.get('/interpreters/me/credentials', async (req, res) => {
  const user = requireRoles(req, ['interpreter']);
  res.json({ credentials: await listCredentials(pool, user.id, new Date()) });
});

interpretersRouter.post('/interpreters/me/credentials', async (req, res) => {
  const user = requireRoles(req, ['interpreter']);
  const multipart = await readMultipart(req);
  const input = readCredentialInput(multipart.fields);
  const file = singleFile(multipart, 'scan');
  const contentType = resolveContentType(file, SCAN_TYPES);
  const credential = await addCredential({
    interpreterId: user.id,
    type: input.type,
    number: input.number,
    expiresOn: input.expiresOn,
    scan: { filename: file.filename, contentType, bytes: file.bytes },
    now: new Date(),
  });
  res.status(201).json({ credential });
});

interpretersRouter.get('/credentials/:id/scan', async (req, res) => {
  const user = requireAuth(req);
  const scan = await loadScan(pool, pathParam(req, 'id'));
  const allowed = user.role === 'coordinator' || scan.interpreterId === user.id;
  if (!allowed) throw notFound();
  const object = await getObject(scan.objectKey);
  res.setHeader('Content-Type', scan.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${scan.filename}"`);
  res.send(object.body);
});

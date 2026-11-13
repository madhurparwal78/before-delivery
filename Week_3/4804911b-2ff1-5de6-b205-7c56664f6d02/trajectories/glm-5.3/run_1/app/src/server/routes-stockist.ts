import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { App } from './main.js';
import type { Session } from './routes.js';
import { sendJson, readJson, BodyLimitError } from './api/http.js';
import { checkEndpointAddress, ADDRESS_MESSAGE } from './domain/address.js';
import { newSigningSecret, testEventId } from './services/svix.js';

const MAX_JSON_BYTES = 1000000;

export async function apiEndpoints(app: App, session: Session, res: ServerResponse): Promise<void> {
  const r = await app.pool.query<{ id: string; url: string; registered: boolean; created_at: Date }>(
    'SELECT id, url, registered, created_at FROM endpoints WHERE account_id = $1 AND removed = false ORDER BY created_at',
    [session.accountId]
  );
  sendJson(res, 200, {
    endpoints: r.rows.map((e) => ({ id: e.id, url: e.url, registered: e.registered, createdAt: e.created_at.toISOString() })),
  });
}

export async function apiSaveEndpoint(app: App, req: IncomingMessage, session: Session, res: ServerResponse): Promise<void> {
  let body: { url?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  if (typeof body.url !== 'string') return sendJson(res, 422, { error: 'endpoint_refused', message: ADDRESS_MESSAGE, reason: 'invalid' });
  const check = await checkEndpointAddress(body.url, app.config.endpointAllowedCidrs);
  if (!check.ok) return sendJson(res, 422, { error: 'endpoint_refused', message: ADDRESS_MESSAGE, reason: check.reason });
  const norm = check.normalised;
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    // One account's live-endpoint slots are guarded by an advisory lock so
    // simultaneous saves respect the limit and URL identity exactly.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`endpoints-${session.accountId}`]);
    const live = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM endpoints WHERE account_id = $1 AND removed = false',
      [session.accountId]
    );
    if (Number(live.rows[0].count) >= 5) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'endpoint_limit', message: 'You may keep five live endpoints.' });
    }
    const same = await client.query<{ id: string }>(
      'SELECT id FROM endpoints WHERE account_id = $1 AND removed = false AND normalised_url = $2',
      [session.accountId, norm]
    );
    if (same.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'endpoint_exists', message: 'That endpoint is already saved.' });
    }
    const id = randomBytes(12).toString('hex');
    const secret = newSigningSecret();
    await client.query(
      "INSERT INTO endpoints (id, account_id, url, normalised_url, signing_secret, registered, created_at) VALUES ($1, $2, $3, $4, $5, false, now())",
      [id, session.accountId, body.url.trim(), norm, secret]
    );
    // The registration work is written in the same transaction as the save, so a
    // save during an outage is registered later with that same secret.
    await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['register_endpoint', JSON.stringify({ endpointId: id })]);
    await client.query('COMMIT');
    sendJson(res, 201, {
      id,
      url: body.url.trim(),
      registered: false,
      createdAt: new Date().toISOString(),
      signingSecret: secret,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function apiTestEndpoint(app: App, req: IncomingMessage, session: Session, res: ServerResponse, id: string): Promise<void> {
  const r = await app.pool.query<{ id: string; url: string; removed: boolean }>(
    'SELECT id, url, removed FROM endpoints WHERE id = $1 AND account_id = $2',
    [id, session.accountId]
  );
  if (r.rows.length === 0 || r.rows[0].removed) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  // The address is checked on save and again before each test send.
  const check = await checkEndpointAddress(r.rows[0].url, app.config.endpointAllowedCidrs);
  if (!check.ok) return sendJson(res, 422, { error: 'endpoint_refused', message: ADDRESS_MESSAGE, reason: check.reason });
  const eventId = testEventId(id);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO deliveries (event_id, account_id, endpoint_id, notice_number, notice_version, event_type, state) VALUES ($1, $2, $3, NULL, NULL, 'interval.test', 'pending') ON CONFLICT (event_id) DO NOTHING",
      [eventId, session.accountId, id]
    );
    await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['send', JSON.stringify({ jobId: eventId, kind: 'send', eventId })]);
    await client.query('COMMIT');
    sendJson(res, 202, { eventId });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function apiRotateSecret(app: App, session: Session, res: ServerResponse, id: string): Promise<void> {
  if (!app.svix.reachable) {
    return sendJson(res, 503, { error: 'rotation_unavailable', message: 'Rotation needs the message service. Try again shortly.' });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string; svix_endpoint_id: string | null; rotating: boolean; registered: boolean; removed: boolean }>(
      'SELECT id, svix_endpoint_id, rotating, registered, removed FROM endpoints WHERE id = $1 AND account_id = $2 FOR UPDATE',
      [id, session.accountId]
    );
    if (r.rows.length === 0 || r.rows[0].removed) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    if (r.rows[0].rotating) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'rotation_in_progress', message: 'This secret is already being rotated.' });
    }
    const row = r.rows[0];
    // Rotation goes through Svix's own rotation; during the overlap window one
    // message's signature header verifies with both the old and the new secret.
    if (row.registered && row.svix_endpoint_id) {
      const ok = await app.svix.rotateSecret(session.accountId, row.svix_endpoint_id);
      if (!ok) {
        await client.query('ROLLBACK');
        return sendJson(res, 503, { error: 'rotation_unavailable', message: 'Rotation needs the message service. Try again shortly.' });
      }
    }
    const newSecret = newSigningSecret();
    await client.query('UPDATE endpoints SET signing_secret = $2, rotating = false WHERE id = $1', [id, newSecret]);
    await client.query('COMMIT');
    sendJson(res, 200, { id, signingSecret: newSecret });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function apiRecover(app: App, session: Session, res: ServerResponse, id: string): Promise<void> {
  const ep = await app.pool.query<{ id: string; removed: boolean }>('SELECT id, removed FROM endpoints WHERE id = $1 AND account_id = $2', [id, session.accountId]);
  if (ep.rows.length === 0 || ep.rows[0].removed) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const failed = await client.query<{ event_id: string }>(
      "SELECT event_id FROM deliveries WHERE endpoint_id = $1 AND state = 'failed' AND redelivery_outstanding = false FOR UPDATE",
      [id]
    );
    if (failed.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'nothing_failed', message: 'Nothing on this endpoint is waiting for recovery.' });
    }
    const requested: string[] = [];
    for (const f of failed.rows) {
      await client.query('UPDATE deliveries SET redelivery_outstanding = true, redelivery_requested = true WHERE event_id = $1', [f.event_id]);
      await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['redeliver', JSON.stringify({ jobId: f.event_id, kind: 'send', eventId: f.event_id })]);
      requested.push(f.event_id);
    }
    await client.query('COMMIT');
    sendJson(res, 202, { requested });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function apiRemoveEndpoint(app: App, session: Session, res: ServerResponse, id: string): Promise<void> {
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string; svix_endpoint_id: string | null; removed: boolean }>(
      'SELECT id, svix_endpoint_id, removed FROM endpoints WHERE id = $1 AND account_id = $2 FOR UPDATE',
      [id, session.accountId]
    );
    if (r.rows.length === 0 || r.rows[0].removed) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    await client.query('UPDATE endpoints SET removed = true WHERE id = $1', [id]);
    await client.query(
      "UPDATE deliveries SET state = 'cancelled', cancelled = true WHERE endpoint_id = $1 AND state NOT IN ('delivered','redelivered','cancelled')",
      [id]
    );
    await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['remove_endpoint', JSON.stringify({ endpointId: id })]);
    await client.query('COMMIT');
    if (r.rows[0].svix_endpoint_id) {
      await app.svix.deleteEndpoint(session.accountId, r.rows[0].svix_endpoint_id);
    }
    res.writeHead(204);
    res.end();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function apiDeliveries(app: App, session: Session, res: ServerResponse): Promise<void> {
  const r = await app.pool.query(
    `SELECT d.event_id, d.event_type, d.notice_number, d.notice_version, d.endpoint_id, e.url, e.removed, d.state, d.redelivery_requested
     FROM deliveries d LEFT JOIN endpoints e ON e.id = d.endpoint_id
     WHERE d.account_id = $1 ORDER BY d.event_id DESC`,
    [session.accountId]
  );
  const out = [];
  for (const d of r.rows) {
    const attempts = await app.pool.query<{ response_status: number | null; outcome: string; at: Date }>(
      'SELECT response_status, outcome, at FROM delivery_attempts WHERE event_id = $1 ORDER BY at, id',
      [d.event_id]
    );
    out.push({
      eventId: d.event_id,
      eventType: d.event_type,
      noticeNumber: d.notice_number,
      noticeVersion: d.notice_version,
      endpointId: d.endpoint_id,
      endpointUrl: d.url,
      endpointRemoved: d.removed,
      state: d.state,
      redeliveryRequested: d.redelivery_requested,
      attempts: attempts.rows.map((a) => ({ at: a.at.toISOString(), responseStatus: a.response_status, outcome: a.outcome })),
    });
  }
  sendJson(res, 200, {
    messagesQueued: !app.svix.reachable,
    workQueued: !app.queue.reachable,
    deliveries: out,
  });
}

export async function apiRedeliver(app: App, session: Session, res: ServerResponse, eventId: string): Promise<void> {
  const d = await app.pool.query<{ account_id: string; endpoint_id: string; state: string; redelivery_outstanding: boolean }>(
    'SELECT account_id, endpoint_id, state, redelivery_outstanding FROM deliveries WHERE event_id = $1',
    [eventId]
  );
  if (d.rows.length === 0 || d.rows[0].account_id !== session.accountId) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const ep = await app.pool.query<{ removed: boolean }>('SELECT removed FROM endpoints WHERE id = $1', [d.rows[0].endpoint_id]);
  if (ep.rows.length === 0 || ep.rows[0].removed) return sendJson(res, 409, { error: 'endpoint_removed', message: 'That endpoint is removed.' });
  if (d.rows[0].state !== 'failed') return sendJson(res, 409, { error: 'not_failed', message: 'Only a failed message can be redelivered.' });
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE deliveries SET redelivery_outstanding = true, redelivery_requested = true WHERE event_id = $1', [eventId]);
    await client.query('INSERT INTO outbox (kind, payload) VALUES ($1, $2)', ['redeliver', JSON.stringify({ jobId: eventId, kind: 'send', eventId })]);
    await client.query('COMMIT');
    sendJson(res, 202, { eventId, state: d.rows[0].state, redeliveryRequested: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

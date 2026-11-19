import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool.js';
import type { WorkspaceRow } from '../db/records.js';
import { config } from '../config.js';
import { ApiError, notFound, unprocessable } from '../http/errors.js';
import { jsonBody, type RequestContext } from '../http/context.js';
import { isCallbackType, isStateEventType } from '../domain/subscription.js';
import { billingEventsFor, statusFrom } from '../services/workspaces.js';
import type { Router } from '../http/router.js';

function headerValue(context: RequestContext, name: string): string {
  const raw = context.request.headers[name];
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

function verifySignature(context: RequestContext, timestamp: string): void {
  const expected = `v1=${createHmac('sha256', config.killbill.apiSecret)
    .update(`${timestamp}.`)
    .update(context.rawBody)
    .digest('hex')}`;
  const provided = headerValue(context, 'x-tidemark-signature');
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ApiError(401, 'invalid_signature', 'That signature does not match.');
  }
}

function verifyTimestamp(timestamp: string): void {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw new ApiError(401, 'stale_timestamp', 'That timestamp is not fresh.');
  }
  const drift = Math.abs(Date.now() / 1000 - seconds);
  if (drift > config.billingCallbackToleranceSeconds) {
    throw new ApiError(401, 'stale_timestamp', 'That timestamp is not fresh.');
  }
}

/**
 * A verified callback is stored, then the workspace state is replayed from every stored
 * event, so the final state never depends on arrival order.
 */
async function callback(context: RequestContext): Promise<unknown> {
  const timestamp = headerValue(context, 'x-tidemark-timestamp');
  verifySignature(context, timestamp);
  verifyTimestamp(timestamp);

  const body = jsonBody(context);
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const type = typeof body.type === 'string' ? body.type : '';
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const occurredAtRaw = typeof body.occurredAt === 'string' ? body.occurredAt : '';
  const occurredAt = new Date(occurredAtRaw);
  const seats = typeof body.seats === 'number' && Number.isInteger(body.seats) ? body.seats : null;

  if (eventId === '' || !isCallbackType(type) || Number.isNaN(occurredAt.getTime())) {
    throw unprocessable('validation_failed', 'Send eventId, a known type and an occurredAt instant.');
  }
  if (type === 'seats.changed' && seats === null) {
    throw unprocessable('validation_failed', 'A seats.changed event needs a seats count.');
  }

  const seen = await pool.query('select 1 from billing_events where event_id = $1', [eventId]);
  if ((seen.rowCount ?? 0) > 0) return { received: true, duplicate: true };

  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new ApiError(404, 'unknown_workspace', 'That workspace was not found.');
  }
  const workspace = await pool.query<WorkspaceRow>('select * from workspaces where id = $1', [workspaceId]);
  const row = workspace.rows[0];
  if (!row) throw new ApiError(404, 'unknown_workspace', 'That workspace was not found.');

  const inserted = await pool.query(
    `insert into billing_events (event_id, workspace_id, type, occurred_at, seats, received_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (event_id) do nothing`,
    [eventId, workspaceId, type, occurredAt, seats],
  );
  if (inserted.rowCount !== 1) return { received: true, duplicate: true };

  const status = statusFrom(row, await billingEventsFor(workspaceId));
  const applied = isStateEventType(type)
    ? status.appliedEventIds.has(eventId)
    : status.newestSeatEventId === eventId;
  return { received: true, applied };
}

export function registerBillingRoutes(router: Router): void {
  router.post('/api/billing/callbacks', callback);
}

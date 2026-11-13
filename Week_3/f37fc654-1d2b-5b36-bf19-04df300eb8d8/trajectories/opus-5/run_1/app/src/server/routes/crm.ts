import { Router } from 'express';
import { query } from '../db/pool.js';
import { ValidationError, serviceDown } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller, requireRole } from '../http/session.js';
import { commissionFor } from '../domain/access.js';
import * as svix from '../services/svix.js';
import { CRM_URL_INVALID } from '../../shared/copy.js';
import { isoUtc } from '../../shared/venue-time.js';

export const crmRouter = Router();

const MAX_URL_LENGTH = 2048;

function readEndpointUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new ValidationError({ url: CRM_URL_INVALID });
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError({ url: CRM_URL_INVALID });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError({ url: CRM_URL_INVALID });
  }
  return parsed.toString();
}

crmRouter.put(
  '/api/me/crm-endpoint',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'client');
    const url = readEndpointUrl(bodyObject(req)['url']);

    let details: svix.EndpointDetails;
    try {
      details = await svix.setEndpoint(caller.user.id, caller.user.name, url);
    } catch (error) {
      if (error instanceof svix.WebhooksUnavailable) {
        throw serviceDown('svix', 'webhooks_unavailable');
      }
      throw error;
    }
    await query(
      `UPDATE app_users SET crm_endpoint_url = $2, crm_signing_secret = $3 WHERE id = $1`,
      [caller.user.id, details.url, details.signingSecret],
    );
    res.json({ url: details.url, signingSecret: details.signingSecret });
  }),
);

crmRouter.get(
  '/api/me/crm-endpoint',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const result = await query<{ crm_endpoint_url: string | null; crm_signing_secret: string | null }>(
      'SELECT crm_endpoint_url, crm_signing_secret FROM app_users WHERE id = $1',
      [caller.user.id],
    );
    const row = result.rows[0];
    if (!row?.crm_endpoint_url) {
      res.json({ url: null });
      return;
    }
    res.json({ url: row.crm_endpoint_url, signingSecret: row.crm_signing_secret });
  }),
);

/** The delivery log, read from the webhook service. */
crmRouter.get(
  '/api/commissions/:commissionId/webhook-deliveries',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const events = await query<{
      id: string;
      event_type: string;
      created_at: Date;
      svix_message_id: string | null;
      final_state: string;
      client_id: string;
    }>(
      `SELECT id, event_type, created_at, svix_message_id, final_state, client_id
         FROM crm_events WHERE commission_id = $1 ORDER BY created_at DESC`,
      [commission.id],
    );

    const deliveries = await Promise.all(
      events.rows.map(async (event) => {
        let attempts: svix.DeliveryAttempt[] = [];
        let finalState: svix.DeliveryFinalState =
          event.final_state as svix.DeliveryFinalState;
        if (event.svix_message_id) {
          try {
            const read = await svix.readDelivery(event.client_id, event.svix_message_id);
            attempts = read.attempts;
            finalState = read.finalState;
          } catch {
            finalState = 'pending';
          }
        }
        return {
          eventId: event.id,
          eventType: event.event_type,
          createdAt: isoUtc(event.created_at),
          attempts,
          finalState,
        };
      }),
    );
    res.json({ deliveries });
  }),
);

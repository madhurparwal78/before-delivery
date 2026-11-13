import { randomBytes } from 'node:crypto';
import { ApiError } from '../domain/errors.js';
import { today } from '../domain/clock.js';
import { deliveryState, finishedAttempts, redeliveryOutstanding } from '../domain/delivery.js';
import { checkEndpointAddress, normaliseUrl } from '../domain/endpointAddress.js';
import { priceSheetCsv } from '../domain/priceSheetCsv.js';
import { sentences } from '../domain/sentences.js';
import { isUniqueViolation, query, withTransaction } from '../db/pool.js';
import { loadAliasesBySku, loadPriceBook } from '../db/queries.js';
import {
  cancelUndelivered,
  deliveriesForAccount,
  deliveryById,
  endpointById,
  insertDelivery,
  liveEndpoints,
  newId,
  requestRedelivery,
  storeAttempts,
  type DeliveryRecord,
  type EndpointRecord,
} from '../db/repo.js';
import { brokerDown } from '../services/broker.js';
import { deadline, DeadlinePassed, withDeadline } from '../services/state.js';
import { enqueue, sendJob } from '../services/outbox.js';
import {
  createEndpoint,
  deleteEndpoint,
  ensureApplication,
  listAttempts,
  newSigningSecret,
  rotateEndpointSecret,
  svixDown,
  SvixUnavailable,
} from '../services/svix.js';
import { requireRole, requireSignedIn } from './guards.js';
import { jsonBody, requireBodySize, route, type Ctx, type Reply } from './server.js';

const MAX_LIVE_ENDPOINTS = 5;

function endpointView(endpoint: EndpointRecord): Record<string, unknown> {
  return {
    id: endpoint.id,
    url: endpoint.url,
    registered: endpoint.registered,
    createdAt: endpoint.createdAt,
  };
}

function refusal(reason: string): ApiError {
  return new ApiError(422, 'endpoint_refused', sentences.endpointRefused, { reason });
}

async function ownEndpoint(ctx: Ctx, accountId: string): Promise<EndpointRecord> {
  const endpoint = await endpointById(ctx.params.id);
  if (endpoint === null || endpoint.accountId !== accountId || endpoint.removedAt !== null) {
    throw new ApiError(404, 'not_found', 'That endpoint is not on file.');
  }
  return endpoint;
}

/** Reads Svix for the attempts of entries that are not yet settled. */
async function refreshAttempts(accountId: string, deliveries: DeliveryRecord[]): Promise<DeliveryRecord[]> {
  const refreshed: DeliveryRecord[] = [];
  const until = deadline(2_500);
  for (const delivery of deliveries) {
    if (until.passed()) {
      refreshed.push(delivery);
      continue;
    }
    const settled =
      delivery.attempts.some((attempt) => attempt.outcome === 'success') &&
      !redeliveryOutstanding(delivery);
    if (!delivery.handedOver || settled || svixDown()) {
      refreshed.push(delivery);
      continue;
    }
    try {
      const attempts = await listAttempts(accountId, delivery.eventId);
      if (attempts.length !== delivery.attempts.length) {
        await storeAttempts(delivery.eventId, attempts);
      }
      refreshed.push({ ...delivery, attempts });
    } catch {
      refreshed.push(delivery);
    }
  }
  return refreshed;
}

async function registerAtSvix(
  account: { id: string; displayName: string },
  endpoint: { id: string; url: string; secret: string },
): Promise<void> {
  await ensureApplication(account.id, account.displayName);
  const svixEndpointId = await createEndpoint(account.id, endpoint.id, endpoint.url, endpoint.secret);
  await query('update endpoints set registered = true, svix_endpoint_id = $2 where id = $1', [
    endpoint.id,
    svixEndpointId,
  ]);
}

/** Rotation goes through Svix's own rotation, so both secrets verify during its overlap. */
async function rotateAtSvix(
  account: { id: string; displayName: string },
  endpoint: EndpointRecord,
  secret: string,
): Promise<void> {
  await ensureApplication(account.id, account.displayName);
  if (!endpoint.registered) {
    const svixEndpointId = await createEndpoint(account.id, endpoint.id, endpoint.url, endpoint.signingSecret);
    await query('update endpoints set registered = true, svix_endpoint_id = $2 where id = $1', [
      endpoint.id,
      svixEndpointId,
    ]);
  }
  await rotateEndpointSecret(account.id, endpoint.id, secret);
}

export function registerStockistRoutes(): void {
  route('GET', '/api/stockist/endpoints', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    const endpoints = await liveEndpoints(account.id);
    return { status: 200, body: { endpoints: endpoints.map(endpointView) } };
  });

  route('POST', '/api/stockist/endpoints', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    let normalised: string | null = null;
    try {
      normalised = raw === '' ? null : normaliseUrl(new URL(raw));
    } catch {
      normalised = null;
    }

    const prepared = await withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`endpoints:${account.id}`]);
      const live = await liveEndpoints(account.id, client);
      if (normalised !== null && live.some((endpoint) => endpoint.normalisedUrl === normalised)) {
        throw new ApiError(409, 'endpoint_exists', 'That address is already on file.');
      }
      if (live.length >= MAX_LIVE_ENDPOINTS) {
        throw new ApiError(409, 'endpoint_limit', 'That account already has five endpoints.');
      }
      const check = await checkEndpointAddress(raw);
      if (!check.ok) throw refusal(check.reason ?? 'invalid');
      const id = newId();
      const secret = newSigningSecret();
      try {
        await client.query(
          `insert into endpoints (id, account_id, url, normalised_url, signing_secret, registered)
           values ($1, $2, $3, $4, $5, false)`,
          [id, account.id, raw, check.normalisedUrl, secret],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(409, 'endpoint_exists', 'That address is already on file.');
        }
        throw error;
      }
      return { id, secret, url: raw };
    });

    try {
      await withDeadline(registerAtSvix(account, prepared), 3_000);
    } catch {
      /* the endpoint is registered later with this same secret */
    }

    const saved = await endpointById(prepared.id);
    return {
      status: 201,
      body: { ...endpointView(saved as EndpointRecord), signingSecret: prepared.secret },
    };
  });

  route('POST', '/api/stockist/endpoints/:id/test', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    requireBodySize(ctx);
    const endpoint = await ownEndpoint(ctx, account.id);
    const check = await checkEndpointAddress(endpoint.url);
    if (!check.ok) throw refusal(check.reason ?? 'invalid');
    const eventId = `test-${endpoint.id}-${randomBytes(6).toString('hex')}`;
    await withTransaction(async (client) => {
      await insertDelivery(client, {
        eventId,
        accountId: account.id,
        endpointId: endpoint.id,
        eventType: 'interval.test',
        noticeNumber: null,
        noticeVersion: null,
        payload: { eventType: 'interval.test', eventId, endpointId: endpoint.id },
      });
      await enqueue(client, sendJob(eventId));
    });
    return { status: 202, body: { eventId } };
  });

  route('POST', '/api/stockist/endpoints/:id/rotate-secret', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    requireBodySize(ctx);
    const endpoint = await ownEndpoint(ctx, account.id);
    const claimed = await query(
      'update endpoints set rotating = true where id = $1 and rotating = false returning id',
      [endpoint.id],
    );
    if (claimed.rowCount === 0) {
      throw new ApiError(409, 'rotation_in_progress', sentences.rotationInProgress);
    }
    const secret = newSigningSecret();
    try {
      await withDeadline(rotateAtSvix(account, endpoint, secret), 4_000);
    } catch (error) {
      await query('update endpoints set rotating = false where id = $1', [endpoint.id]);
      if (error instanceof SvixUnavailable || error instanceof DeadlinePassed) {
        throw new ApiError(503, 'rotation_unavailable', sentences.rotationUnavailable);
      }
      throw error;
    }
    await query('update endpoints set signing_secret = $2, rotating = false where id = $1', [
      endpoint.id,
      secret,
    ]);
    return { status: 200, body: { id: endpoint.id, signingSecret: secret } };
  });

  route('POST', '/api/stockist/endpoints/:id/recover', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    requireBodySize(ctx);
    const endpoint = await ownEndpoint(ctx, account.id);
    const all = (await deliveriesForAccount(account.id)).filter(
      (delivery) => delivery.endpointId === endpoint.id,
    );
    const refreshed = await refreshAttempts(account.id, all);
    const eligible = refreshed.filter(
      (delivery) => deliveryState(delivery) === 'failed' && !redeliveryOutstanding(delivery),
    );
    if (eligible.length === 0) {
      throw new ApiError(409, 'nothing_failed', sentences.nothingToRecover);
    }
    await withTransaction(async (client) => {
      for (const delivery of eligible) {
        await requestRedelivery(client, delivery.eventId, finishedAttempts(delivery.attempts).length);
        await enqueue(client, sendJob(delivery.eventId));
      }
    });
    return { status: 202, body: { requested: eligible.map((delivery) => delivery.eventId) } };
  });

  route('DELETE', '/api/stockist/endpoints/:id', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    const endpoint = await ownEndpoint(ctx, account.id);
    await withTransaction(async (client) => {
      await client.query('update endpoints set removed_at = now() where id = $1', [endpoint.id]);
      await cancelUndelivered(client, endpoint.id);
    });
    try {
      await withDeadline(deleteEndpoint(account.id, endpoint.id), 3_000);
      await query('update endpoints set registered = false where id = $1', [endpoint.id]);
    } catch {
      /* the removal is applied when the message service returns */
    }
    return { status: 204 };
  });

  route('GET', '/api/stockist/deliveries', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    const stored = await deliveriesForAccount(account.id);
    const refreshed = await refreshAttempts(account.id, stored);
    const endpoints = new Map<string, EndpointRecord>();
    for (const delivery of refreshed) {
      if (!endpoints.has(delivery.endpointId)) {
        const endpoint = await endpointById(delivery.endpointId);
        if (endpoint !== null) endpoints.set(delivery.endpointId, endpoint);
      }
    }
    return {
      status: 200,
      body: {
        messagesQueued: svixDown(),
        workQueued: brokerDown(),
        deliveries: refreshed.map((delivery) => {
          const endpoint = endpoints.get(delivery.endpointId);
          return {
            eventId: delivery.eventId,
            eventType: delivery.eventType,
            noticeNumber: delivery.noticeNumber,
            noticeVersion: delivery.noticeVersion,
            endpointId: delivery.endpointId,
            endpointUrl: endpoint?.url ?? '',
            endpointRemoved: endpoint?.removedAt !== null && endpoint?.removedAt !== undefined,
            state: deliveryState(delivery),
            redeliveryRequested: delivery.redeliveryRequested,
            attempts: delivery.attempts,
          };
        }),
      },
      headers: { 'cache-control': 'no-store' },
    };
  });

  route('POST', '/api/stockist/deliveries/:eventId/redeliver', async (ctx: Ctx): Promise<Reply> => {
    const account = await requireRole(ctx, 'stockist');
    requireBodySize(ctx);
    const delivery = await deliveryById(ctx.params.eventId);
    if (delivery === null || delivery.accountId !== account.id) {
      throw new ApiError(404, 'not_found', 'That message is not on file.');
    }
    const endpoint = await endpointById(delivery.endpointId);
    if (endpoint === null || endpoint.removedAt !== null) {
      throw new ApiError(409, 'endpoint_removed', 'That endpoint has been removed.');
    }
    const [refreshed] = await refreshAttempts(account.id, [delivery]);
    if (deliveryState(refreshed) !== 'failed') {
      throw new ApiError(409, 'not_failed', 'Only a failed message can be sent again.');
    }
    await withTransaction(async (client) => {
      await requestRedelivery(client, refreshed.eventId, finishedAttempts(refreshed.attempts).length);
      await enqueue(client, sendJob(refreshed.eventId));
    });
    return {
      status: 202,
      body: { eventId: refreshed.eventId, state: 'failed', redeliveryRequested: true },
    };
  });

  route('GET', '/api/stockist/price-sheet.csv', async (ctx: Ctx): Promise<Reply> => {
    await requireSignedIn(ctx);
    const book = await loadPriceBook();
    const aliases = await loadAliasesBySku();
    const todayDate = today();
    return {
      status: 200,
      text: priceSheetCsv(book, aliases, todayDate),
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="interval-price-sheet-${todayDate}.csv"`,
        'cache-control': 'no-store',
      },
    };
  });
}

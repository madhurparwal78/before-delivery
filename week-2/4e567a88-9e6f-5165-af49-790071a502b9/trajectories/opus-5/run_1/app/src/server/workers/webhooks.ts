import { createHmac } from 'node:crypto';
import { config } from '../config';
import { noticeEndpointDisabled } from '../services/notices';
import { deliverWebhook } from '../services/outbound';
import { teamById } from '../store/people';
import {
  EndpointRecord,
  EventRecord,
  allDeliverableEndpoints,
  insertDelivery,
  nextPendingEvent,
  pendingEventsOf,
  setEndpointFailure,
  setEventState,
} from '../store/webhooks';

const MAX_CONSECUTIVE_FAILURES = 6;
const inFlight = new Set<string>();

function signature(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function backoffMs(attempt: number): number {
  return config.webhookRetryBaseSeconds * 1000 * 2 ** (attempt - 1);
}

async function disableEndpoint(endpoint: EndpointRecord, event: EventRecord, statusCode: number | null): Promise<void> {
  await setEndpointFailure(endpoint.id, MAX_CONSECUTIVE_FAILURES, 'disabled');
  await setEventState(event.id, 'abandoned', event.attempts + 1, new Date(), statusCode);
  for (const waiting of await pendingEventsOf(endpoint.id)) {
    await setEventState(waiting.id, 'skipped_disabled', waiting.attempts, new Date(), null);
    await insertDelivery({
      eventId: waiting.id,
      endpointId: endpoint.id,
      eventType: waiting.eventType,
      jobId: waiting.jobId,
      attempt: waiting.attempts + 1,
      statusCode: null,
      outcome: 'skipped_disabled',
      nextAttemptAt: null,
    });
  }
  const team = await teamById(endpoint.teamId);
  if (team) await noticeEndpointDisabled(team, endpoint.url, statusCode);
}

async function attemptNext(endpoint: EndpointRecord): Promise<void> {
  const event = await nextPendingEvent(endpoint.id);
  if (!event || event.nextAttemptAt.getTime() > Date.now()) return;
  const attempt = event.attempts + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await deliverWebhook(endpoint.url, event.body, {
    'content-type': 'application/json',
    'dispatch-event-id': event.id,
    'dispatch-timestamp': String(timestamp),
    'dispatch-signature': signature(endpoint.secret, timestamp, event.body),
  });
  const statusCode = result.kind === 'answered' ? result.statusCode : null;
  const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;

  if (delivered) {
    await setEventState(event.id, 'delivered', attempt, new Date(), statusCode);
    await setEndpointFailure(endpoint.id, 0, 'active');
    await insertDelivery({
      eventId: event.id,
      endpointId: endpoint.id,
      eventType: event.eventType,
      jobId: event.jobId,
      attempt,
      statusCode,
      outcome: 'delivered',
      nextAttemptAt: null,
    });
    return;
  }

  const failures = endpoint.consecutiveFailures + 1;
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    await insertDelivery({
      eventId: event.id,
      endpointId: endpoint.id,
      eventType: event.eventType,
      jobId: event.jobId,
      attempt,
      statusCode,
      outcome: 'failed',
      nextAttemptAt: null,
    });
    await disableEndpoint(endpoint, event, statusCode);
    return;
  }
  const nextAttemptAt = new Date(Date.now() + backoffMs(attempt));
  await setEventState(event.id, 'pending', attempt, nextAttemptAt, statusCode);
  await setEndpointFailure(endpoint.id, failures, 'failing');
  await insertDelivery({
    eventId: event.id,
    endpointId: endpoint.id,
    eventType: event.eventType,
    jobId: event.jobId,
    attempt,
    statusCode,
    outcome: 'failed',
    nextAttemptAt,
  });
}

async function tick(): Promise<void> {
  const endpoints = await allDeliverableEndpoints();
  await Promise.all(
    endpoints.map(async (endpoint) => {
      if (inFlight.has(endpoint.id)) return;
      inFlight.add(endpoint.id);
      try {
        await attemptNext(endpoint);
      } finally {
        inFlight.delete(endpoint.id);
      }
    }),
  );
}

/** Delivers each endpoint's events one at a time, oldest first, on the published backoff schedule. */
export function startWebhookDelivery(): void {
  setInterval(() => {
    tick().catch((error: unknown) => console.error('webhook tick failed', error));
  }, 500).unref();
}

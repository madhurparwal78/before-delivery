import { query, withTransaction } from '../db/pool.js';
import { claimJobs, markDone, markFailed, markRetry, type JobRow } from './queue.js';
import { publishNow } from './events.js';
import { sendEmail } from '../services/mail.js';
import { renderPdf } from '../services/gotenberg.js';
import { getObject, objectKeys, putObject } from '../services/s3.js';
import { postCrewAlert } from '../services/ntfy.js';
import * as svix from '../services/svix.js';
import {
  RenderProviderRejected,
  callbackUrl,
  submitRender,
} from '../services/render-provider.js';
import { findCommission } from '../domain/commissions.js';
import { markPreviewed } from '../domain/transitions.js';
import { formatVenueDate } from '../../shared/venue-time.js';
import * as copy from '../../shared/copy.js';

/**
 * Job handlers. A handler either succeeds, asks to be retried because its
 * service is unreachable, or fails for good when the work can never succeed.
 */

class RetryLater extends Error {}
class GiveUp extends Error {}

type Handler = (job: JobRow) => Promise<void>;

function stringField(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string') throw new GiveUp(`job payload missing ${name}`);
  return value;
}

const handleEmail: Handler = async (job) => {
  try {
    await sendEmail({
      to: stringField(job.payload, 'to'),
      subject: stringField(job.payload, 'subject'),
      body: stringField(job.payload, 'body'),
    });
  } catch (error) {
    throw new RetryLater(String(error));
  }
};

const handlePdf: Handler = async (job) => {
  const documentId = stringField(job.payload, 'documentId');
  const objectKey = stringField(job.payload, 'objectKey');
  const html = stringField(job.payload, 'html');

  const existing = await query<{ status: string }>(
    'SELECT status FROM documents WHERE id = $1',
    [documentId],
  );
  // An issued document's bytes are never rewritten.
  if (existing.rows[0]?.status === 'issued') return;

  let pdf: Buffer;
  try {
    pdf = await renderPdf(html);
  } catch (error) {
    throw new RetryLater(String(error));
  }
  try {
    const stored = await putObject(objectKey, pdf, 'application/pdf');
    await query(
      `UPDATE documents
          SET status = 'issued', size_bytes = $2, sha256 = $3, issued_at = now()
        WHERE id = $1 AND status <> 'issued'`,
      [documentId, stored.sizeBytes, stored.sha256],
    );
  } catch (error) {
    throw new RetryLater(String(error));
  }
};

const handleCrewAlert: Handler = async (job) => {
  const alertId = stringField(job.payload, 'alertId');
  const result = await query<{ title: string; body: string; status: string }>(
    'SELECT title, body, status FROM crew_alerts WHERE id = $1',
    [alertId],
  );
  const alert = result.rows[0];
  if (!alert) throw new GiveUp('no such crew alert');
  if (alert.status === 'sent') return;
  try {
    await postCrewAlert(alert.title, alert.body);
  } catch (error) {
    throw new RetryLater(String(error));
  }
  await query(
    `UPDATE crew_alerts SET status = 'sent', sent_at = now() WHERE id = $1 AND status <> 'sent'`,
    [alertId],
  );
};

const handleWebhook: Handler = async (job) => {
  const eventId = stringField(job.payload, 'eventId');
  const result = await query<{
    client_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    svix_message_id: string | null;
    name: string;
  }>(
    `SELECT e.client_id, e.event_type, e.payload, e.svix_message_id, u.name
       FROM crm_events e JOIN app_users u ON u.id = e.client_id
      WHERE e.id = $1`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) throw new GiveUp('no such CRM event');
  if (event.svix_message_id) return;

  let endpointPresent: boolean;
  try {
    endpointPresent = await svix.hasEndpoint(event.client_id);
  } catch (error) {
    throw new RetryLater(String(error));
  }
  if (!endpointPresent) {
    await query(`UPDATE crm_events SET final_state = 'no_endpoint' WHERE id = $1`, [eventId]);
    return;
  }
  try {
    const messageId = await svix.sendEvent(event.client_id, event.name, {
      eventId,
      type: event.event_type as svix.CrmEventType,
      occurredAt: String(event.payload['occurredAt'] ?? ''),
      commissionId: String(event.payload['commissionId'] ?? ''),
      data: (event.payload['data'] ?? {}) as Record<string, unknown>,
    });
    await query(
      `UPDATE crm_events SET svix_message_id = $2, final_state = 'pending' WHERE id = $1`,
      [eventId, messageId],
    );
  } catch (error) {
    throw new RetryLater(String(error));
  }
};

const handleRenderSubmit: Handler = async (job) => {
  const renderId = stringField(job.payload, 'renderId');
  const result = await query<{
    id: string;
    commission_id: string;
    state: string;
    reference_image: Record<string, unknown> | null;
    object_key: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
  }>(
    `SELECT r.id, r.commission_id, r.state, r.reference_image,
            f.object_key, f.content_type, f.size_bytes, f.sha256
       FROM renders r JOIN files f ON f.id = r.venue_photo_file_id
      WHERE r.id = $1`,
    [renderId],
  );
  const render = result.rows[0];
  if (!render) throw new GiveUp('no such render');
  if (render.state !== 'queued') return;

  const commission = await findCommission(render.commission_id);
  if (!commission) throw new GiveUp('no such commission');

  let photo: Buffer;
  try {
    photo = (await getObject(render.object_key)).bytes;
  } catch (error) {
    throw new RetryLater(String(error));
  }

  const reference = render.reference_image;
  try {
    const accepted = await submitRender({
      jobRef: render.id,
      installationType: commission.installation_type,
      room: {
        widthM: Number(commission.width_m),
        depthM: Number(commission.depth_m),
        doorWall: commission.door_wall,
      },
      layout: commission.layout_items.length > 0 ? commission.layout_items : null,
      brief: {
        title: commission.title,
        audience: commission.audience,
        notes: commission.notes,
      },
      venuePhoto: {
        contentType: render.content_type,
        sizeBytes: render.size_bytes,
        sha256: render.sha256,
        base64: photo.toString('base64'),
      },
      referenceImage: reference
        ? {
            sourceUrl: String(reference['sourceUrl'] ?? ''),
            contentType: String(reference['contentType'] ?? ''),
            sha256: String(reference['sha256'] ?? ''),
            base64: String(reference['base64'] ?? ''),
          }
        : null,
      callbackUrl: callbackUrl(),
    });
    await query(
      `UPDATE renders SET state = 'submitted', provider_job_id = $2 WHERE id = $1 AND state = 'queued'`,
      [render.id, accepted.providerJobId],
    );
    await publishNow({
      type: 'render.updated',
      renderId: render.id,
      commissionId: render.commission_id,
      state: 'submitted',
      progress: 0,
      audience: [commission.client_id, 'producer'],
    });
  } catch (error) {
    if (error instanceof RenderProviderRejected) {
      await query(
        `UPDATE renders SET state = 'failed', failure_reason = 'provider_rejected' WHERE id = $1`,
        [render.id],
      );
      await publishNow({
        type: 'render.updated',
        renderId: render.id,
        commissionId: render.commission_id,
        state: 'failed',
        progress: 0,
        audience: [commission.client_id, 'producer'],
      });
      throw new GiveUp('provider rejected the render');
    }
    throw new RetryLater(String(error));
  }
};

const handleRenderStore: Handler = async (job) => {
  const renderId = stringField(job.payload, 'renderId');
  const base64 = stringField(job.payload, 'previewBase64');
  const result = await query<{ id: string; commission_id: string; state: string }>(
    'SELECT id, commission_id, state FROM renders WHERE id = $1',
    [renderId],
  );
  const render = result.rows[0];
  if (!render) throw new GiveUp('no such render');
  if (render.state === 'ready') return;

  const bytes = Buffer.from(base64, 'base64');
  const key = objectKeys.render(render.commission_id, render.id);
  try {
    const stored = await putObject(key, bytes, 'image/png');
    // A render is ready only once its preview is stored.
    await query(
      `UPDATE renders
          SET state = 'ready', progress = 100, preview_sha256 = $2, preview_object_key = $3
        WHERE id = $1 AND state <> 'ready'`,
      [render.id, stored.sha256, key],
    );
  } catch (error) {
    throw new RetryLater(String(error));
  }
  await markPreviewed(render.commission_id);
  const commission = await findCommission(render.commission_id);
  await publishNow({
    type: 'render.updated',
    renderId: render.id,
    commissionId: render.commission_id,
    state: 'ready',
    progress: 100,
    audience: commission ? [commission.client_id, 'producer'] : ['producer'],
  });
};

const HANDLERS: Record<JobRow['kind'], Handler> = {
  email: handleEmail,
  pdf: handlePdf,
  crew_alert: handleCrewAlert,
  webhook: handleWebhook,
  render_submit: handleRenderSubmit,
  render_store: handleRenderStore,
};

async function runJob(job: JobRow): Promise<void> {
  const handler = HANDLERS[job.kind];
  try {
    await handler(job);
    await markDone(job.id);
  } catch (error) {
    if (error instanceof GiveUp) {
      await markFailed(job.id, error.message);
      return;
    }
    await markRetry(job.id, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Judge holds that have ended: the day is free again, the commission returns to
 * placed and the hold-ended email is sent once.
 */
async function sweepEndedHolds(): Promise<void> {
  const ended = await query<{
    id: string;
    commission_id: string;
    hold_date: string;
  }>(
    `UPDATE holds SET ended_notified_at = now()
      WHERE released_at IS NULL AND booked_at IS NULL
        AND expires_at <= now() AND ended_notified_at IS NULL
      RETURNING id, commission_id, hold_date`,
  );
  for (const hold of ended.rows) {
    const commission = await findCommission(hold.commission_id);
    if (!commission) continue;
    const client = await query<{ email: string }>('SELECT email FROM app_users WHERE id = $1', [
      commission.client_id,
    ]);
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE commissions SET state = 'placed', updated_at = now()
          WHERE id = $1 AND state = 'held'`,
        [hold.commission_id],
      );
      const email = client.rows[0]?.email;
      if (email) {
        await tx.query(
          `INSERT INTO jobs (id, kind, commission_id, payload, dedupe_key)
           VALUES (gen_random_uuid(), 'email', $1, $2, $3)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [
            hold.commission_id,
            JSON.stringify({
              to: email,
              subject: copy.holdEndedSubject(formatVenueDate(hold.hold_date)),
              body: copy.holdEndedBody(commission.title, formatVenueDate(hold.hold_date)),
            }),
            `email:hold-ended:${hold.id}`,
          ],
        );
      }
    });
    await publishNow({
      type: 'hold.updated',
      commissionId: hold.commission_id,
      status: 'expired',
      audience: [commission.client_id, 'producer'],
    });
    await publishNow({
      type: 'commission.updated',
      commissionId: hold.commission_id,
      state: 'placed',
      audience: [commission.client_id, 'producer'],
    });
  }
}

let running = false;

/** Run the worker loop for the lifetime of the process. */
export function startWorkers(): void {
  if (running) return;
  running = true;
  const tick = async (): Promise<void> => {
    try {
      const jobs = await claimJobs(5);
      await Promise.all(jobs.map((job) => runJob(job)));
      await sweepEndedHolds();
    } catch {
      // The database is unreachable; the next tick tries again.
    }
    setTimeout(() => void tick(), 1_000);
  };
  void tick();
}


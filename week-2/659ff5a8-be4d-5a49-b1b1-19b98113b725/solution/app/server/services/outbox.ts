import { type Db, one, pool, returning, rows, transaction } from "../db.js";
import { ApiError, type ErrorCode } from "../errors.js";
import { sendMail } from "./smtp.js";

type DeliveryKind = "registration" | "assignment" | "results";
type FailureService = "renderer" | "storage" | "mail";

const RETRY_INTERVAL_MS = 10_000;

interface NewDelivery {
  kind: DeliveryKind;
  registrationId: number;
  recipient: string;
  subject: string;
  body: string;
}

export async function queueDelivery(db: Db, delivery: NewDelivery): Promise<number> {
  const row = await returning<{ id: number }>(
    db,
    `insert into email_deliveries (kind, registration_id, recipient, subject, body)
     values ($1, $2, $3, $4, $5) returning id`,
    [delivery.kind, delivery.registrationId, delivery.recipient, delivery.subject, delivery.body],
  );
  return row.id;
}

/** Remember the most recent failed delivery or render/store step for the club that owns the event. */
async function recordFailure(clubId: number, service: FailureService, eventId: number | null): Promise<void> {
  await pool.query(
    "update clubs set failure_service = $2, failure_event_id = $3, failure_at = now() where id = $1",
    [clubId, service, eventId],
  );
}

const FAILED_SERVICE: Partial<Record<ErrorCode, FailureService>> = {
  renderer_unavailable: "renderer",
  storage_unavailable: "storage",
  mail_unavailable: "mail",
};

/** Record the dependency failure an error stands for, if it is one. */
export async function recordFailureFor(error: unknown, clubId: number, eventId: number): Promise<void> {
  const service = error instanceof ApiError ? FAILED_SERVICE[error.code] : undefined;
  if (service) await recordFailure(clubId, service, eventId);
}

interface DeliveryRow {
  recipient: string;
  subject: string;
  body: string;
  club_id: number;
  event_id: number;
}

/** Send one pending delivery once; true when the mail server has accepted it. */
export async function deliver(id: number): Promise<boolean> {
  const failed = await transaction(async (db) => {
    const row = await one<DeliveryRow>(
      db,
      `select d.recipient, d.subject, d.body, e.club_id, e.id as event_id
         from email_deliveries d
         join registrations r on r.id = d.registration_id
         join events e on e.id = r.event_id
        where d.id = $1 and d.status = 'pending' for update of d skip locked`,
      [id],
    );
    if (!row) return null;
    try {
      await sendMail({ to: row.recipient, subject: row.subject, text: row.body });
    } catch {
      return row;
    }
    await db.query("update email_deliveries set status = 'sent', sent_at = now() where id = $1", [id]);
    return null;
  });
  if (failed) await recordFailure(failed.club_id, "mail", failed.event_id);
  const { status } = await returning<{ status: string }>(pool, "select status from email_deliveries where id = $1", [id]);
  return status === "sent";
}

async function retryPending(): Promise<void> {
  const pending = await rows<{ id: number }>(
    pool,
    "select id from email_deliveries where status = 'pending' and kind <> 'results' order by id limit 50",
  );
  for (const { id } of pending) await deliver(id);
}

/** Registration and work-assignment mail is retried until the mail server accepts it. */
export function startRetryWorker(): void {
  const timer = setInterval(() => {
    retryPending().catch((error: unknown) => console.error("mail retry failed", error));
  }, RETRY_INTERVAL_MS);
  timer.unref();
}

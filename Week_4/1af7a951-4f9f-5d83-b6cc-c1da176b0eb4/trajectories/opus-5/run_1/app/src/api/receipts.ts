import { pool, rows } from '../db/pool.js';
import { wakeAlarm } from '../domain/night.js';
import { MailUnavailableError, receiptMessage, send } from '../services/mail.js';
import { findEnrollment } from '../store/enrollments.js';

const RETRY_INTERVAL_MS = 30_000;
const inFlight = new Set<string>();

export async function deliverReceipt(enrollmentId: string): Promise<void> {
  if (inFlight.has(enrollmentId)) return;
  inFlight.add(enrollmentId);
  try {
    const enrollment = await findEnrollment(enrollmentId);
    if (
      enrollment === null ||
      enrollment.status !== 'active' ||
      enrollment.receipt_status !== 'pending' ||
      enrollment.first_night === null ||
      enrollment.paid_amount_cents === null
    ) {
      return;
    }
    await send(
      receiptMessage({
        email: enrollment.email,
        cohortName: enrollment.cohort_name,
        firstNight: enrollment.first_night,
        bedtime: enrollment.bedtime,
        wakeAlarm: wakeAlarm(enrollment.bedtime),
        amountPaidCents: enrollment.paid_amount_cents,
        enrollmentId: enrollment.id,
        accessCode: enrollment.access_code,
      }),
    );
    await pool.query("update enrollments set receipt_status = 'sent' where id = $1", [
      enrollment.id,
    ]);
  } catch (error) {
    if (!(error instanceof MailUnavailableError)) throw error;
  } finally {
    inFlight.delete(enrollmentId);
  }
}

export function startReceiptRetries(): void {
  const timer = setInterval(() => {
    void (async () => {
      const pending = await rows<{ id: string }>(
        "select id from enrollments where receipt_status = 'pending'",
      ).catch(() => []);
      for (const row of pending) await deliverReceipt(row.id);
    })();
  }, RETRY_INTERVAL_MS);
  timer.unref();
}

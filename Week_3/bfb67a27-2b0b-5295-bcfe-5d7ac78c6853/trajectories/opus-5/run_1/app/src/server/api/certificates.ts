import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pool, withTransaction } from '../db.js';
import { notFound, storageUnavailable, validation } from '../errors.js';
import { requireOwner } from '../auth.js';
import { readMultipartBody } from '../http.js';
import { accessBooking } from './access.js';
import { invalidateProviderStatus } from '../providerStatus.js';
import { certificateRejectedMail } from '../mails.js';
import { MESSAGES, isoDateOrNull, looksLikePdf, moneyCents } from '../validate.js';
import * as storage from '../../providers/storage.js';
import { MailUnavailableError, sendMail } from '../../providers/mail.js';
import {
  assertTransitionRole,
  assertTransitionState,
} from '../../domain/transitions.js';
import {
  buildBooking,
  effectiveState,
  findBookingRow,
  findCertificateRow,
} from '../../domain/bookings.js';
import { dateToMs } from '../../shared/dates.js';
import type { Booking, CertificateQueueItem } from '../../shared/types.js';
import { invalidTransition } from '../errors.js';

export function certificateStorageKey(ref: string, certificateId: string): string {
  return `certificates/${ref}/${certificateId}.pdf`;
}

/** The certificate is recorded as under review only once storage has the bytes. */
export async function uploadCertificate(
  req: IncomingMessage,
  ref: string,
): Promise<Booking> {
  const multipart = await readMultipartBody(req);
  const access = await accessBooking(pool, req, ref);
  assertTransitionRole('upload_certificate', access.role);
  assertTransitionState('upload_certificate', access.row);

  const file = multipart.files.file;
  if (file === undefined || file.bytes.byteLength === 0 || !looksLikePdf(file.bytes)) {
    throw validation({ file: 'Upload the certificate as a PDF' });
  }

  const certificateId = randomUUID();
  const storageKey = certificateStorageKey(ref, certificateId);
  try {
    await storage.putObject(storageKey, file.bytes, 'application/pdf');
  } catch (error) {
    if (error instanceof storage.StorageUnavailableError) {
      invalidateProviderStatus();
      throw storageUnavailable();
    }
    throw error;
  }
  await pool.query(
    `INSERT INTO certificates (id, booking_ref, status, size_bytes, storage_key)
     VALUES ($1, $2, 'pending_review', $3, $4)`,
    [certificateId, ref, file.bytes.byteLength, storageKey],
  );

  const row = await findBookingRow(pool, ref);
  if (row === null) throw notFound();
  return buildBooking(pool, row);
}

export async function listCertificates(
  req: IncomingMessage,
  url: URL,
): Promise<{ certificates: CertificateQueueItem[] }> {
  await requireOwner(req);
  const status = url.searchParams.get('status');
  const result = await pool.query<{
    id: string;
    booking_ref: string;
    status: CertificateQueueItem['status'];
    uploaded_at: Date;
    size_bytes: number;
  }>(
    `SELECT id, booking_ref, status, uploaded_at, size_bytes FROM certificates
      WHERE ($1::text IS NULL OR status = $1::text) ORDER BY seq ASC`,
    [status],
  );
  return {
    certificates: result.rows.map((row) => ({
      id: row.id,
      bookingRef: row.booking_ref,
      status: row.status,
      uploadedAt: row.uploaded_at.toISOString(),
      sizeBytes: row.size_bytes,
    })),
  };
}

export async function readCertificateFile(
  req: IncomingMessage,
  id: string,
): Promise<Uint8Array> {
  await requireOwner(req);
  const certificate = await findCertificateRow(pool, id);
  if (certificate === null) throw notFound();
  try {
    return await storage.getObject(certificate.storageKey);
  } catch (error) {
    if (error instanceof storage.StorageUnavailableError) {
      invalidateProviderStatus();
      throw storageUnavailable();
    }
    throw error;
  }
}

interface ApproveDecision {
  decision: 'approve';
  coverageStart: string;
  coverageEnd: string;
  limitCents: number;
}

interface RejectDecision {
  decision: 'reject';
  reason: string;
}

function readDecision(body: Record<string, unknown>): ApproveDecision | RejectDecision {
  if (body.decision === 'approve') {
    const fields: Record<string, string> = {};
    const coverageStart = isoDateOrNull(body.coverageStart);
    if (coverageStart === null) fields.coverageStart = 'Enter the cover start date';
    const coverageEnd = isoDateOrNull(body.coverageEnd);
    if (coverageEnd === null || (coverageStart !== null && dateToMs(coverageEnd) < dateToMs(coverageStart))) {
      fields.coverageEnd = 'Cover must end on or after it starts';
    }
    const limitCents = moneyCents(body.limitCents);
    if (limitCents === null) fields.limitCents = MESSAGES.money;
    if (body.lossPayeeNamed !== true) {
      fields.lossPayeeNamed = 'The certificate must name Northbar Camera Hire as loss payee';
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    return {
      decision: 'approve',
      coverageStart: coverageStart as string,
      coverageEnd: coverageEnd as string,
      limitCents: limitCents as number,
    };
  }
  if (body.decision === 'reject') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 1 || reason.length > 300) {
      throw validation({ reason: 'Give a reason of 1 to 300 characters' });
    }
    return { decision: 'reject', reason };
  }
  throw validation({ decision: 'Choose approve or reject' });
}

export async function reviewCertificate(
  req: IncomingMessage,
  id: string,
  body: Record<string, unknown>,
): Promise<Booking> {
  await requireOwner(req);
  const certificate = await findCertificateRow(pool, id);
  if (certificate === null) throw notFound();

  const outcome = await withTransaction(async (client) => {
    const locked = await findCertificateRow(client, id, true);
    if (locked === null) throw notFound();
    const row = await findBookingRow(client, locked.bookingRef);
    if (row === null) throw notFound();
    if (locked.status !== 'pending_review') {
      throw invalidTransition(row.ref, effectiveState(row));
    }
    const decision = readDecision(body);
    if (decision.decision === 'approve') {
      await client.query(
        `UPDATE certificates
            SET status = 'approved', coverage_start = $2, coverage_end = $3, limit_cents = $4,
                reason = NULL
          WHERE id = $1`,
        [id, decision.coverageStart, decision.coverageEnd, decision.limitCents],
      );
      return { ref: row.ref, rejection: null };
    }
    await client.query(
      `UPDATE certificates
          SET status = 'rejected', reason = $2, coverage_start = NULL, coverage_end = NULL,
              limit_cents = NULL
        WHERE id = $1`,
      [id, decision.reason],
    );
    return { ref: row.ref, rejection: decision.reason };
  });

  if (outcome.rejection !== null) {
    await mailRejectionOnce(id, outcome.ref, outcome.rejection);
  }
  const row = await findBookingRow(pool, outcome.ref);
  if (row === null) throw notFound();
  return buildBooking(pool, row);
}

/** The rejection reason reaches the renter at most once. */
async function mailRejectionOnce(
  certificateId: string,
  ref: string,
  reason: string,
): Promise<void> {
  const claim = await pool.query<{ renter_email: string }>(
    `UPDATE certificates SET rejection_mailed = true
      WHERE id = $1 AND rejection_mailed = false
      RETURNING (SELECT renter_email FROM bookings WHERE ref = $2) AS renter_email`,
    [certificateId, ref],
  );
  const email = claim.rows[0]?.renter_email;
  if (email === undefined) return;
  const mail = certificateRejectedMail(ref, reason);
  try {
    await sendMail(email, mail.subject, mail.body);
  } catch (error) {
    if (!(error instanceof MailUnavailableError)) throw error;
    await pool.query(`UPDATE certificates SET rejection_mailed = false WHERE id = $1`, [
      certificateId,
    ]);
  }
}

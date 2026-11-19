import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { recordActivity } from '../activity.js';
import { isZeroAmount } from '../domain/money.js';
import { loadBoard, findWorkshop, type WorkshopRow } from '../board/repository.js';
import { publishBoardChange } from '../board/events.js';
import { objectKeys, putObject, StorageUnavailable } from '../services/s3.js';
import { BillingUnavailable } from '../services/killbill.js';
import * as killbill from '../services/killbill.js';
import { MailUnavailable, sendMail } from '../services/smtp.js';
import { recapMail } from '../services/mailContent.js';
import { LEASE_SECONDS } from '../services/delivery.js';
import { recapBoardOf, recapCsv, recapFramePng, recapPdf, rankRecapClusters } from './content.js';

export type RecapReason = 'storage_unavailable' | 'billing_unavailable' | 'mail_unavailable';

interface RecapState {
  workshop_id: string;
  status: 'queued' | 'complete';
  files_stored_at: Date | null;
  invoice_id: string | null;
  recap_token: string;
  scale: number;
}

/** Claims one queued recap under a lease, so no two instances attempt it at once. */
async function claimRecap(workshopId: string | null): Promise<RecapState | null> {
  const result = await pool.query<RecapState>(
    `WITH claimed AS (
       SELECT workshop_id FROM recaps
        WHERE status = 'queued'
          AND (lease_until IS NULL OR lease_until < now())
          AND ($1::text IS NULL OR workshop_id = $1::text)
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE recaps r
        SET lease_until = now() + ($2 || ' seconds')::interval, attempts = r.attempts + 1
       WHERE r.workshop_id IN (SELECT workshop_id FROM claimed)
     RETURNING r.workshop_id, r.status, r.files_stored_at, r.invoice_id, r.recap_token, r.scale`,
    [workshopId, String(LEASE_SECONDS)],
  );
  return result.rows[0] ?? null;
}

/** An attempt releases its lease as soon as it records its outcome. */
async function recordOutcome(workshopId: string, reason: RecapReason | null): Promise<void> {
  await pool.query('UPDATE recaps SET reason = $2, lease_until = NULL WHERE workshop_id = $1', [
    workshopId,
    reason,
  ]);
  await announce(workshopId);
}

async function announce(workshopId: string): Promise<void> {
  const bumped = await pool.query<{ version: number }>(
    'UPDATE workshops SET version = version + 1 WHERE id = $1 RETURNING version',
    [workshopId],
  );
  const version = bumped.rows[0]?.version;
  if (version !== undefined) await publishBoardChange(pool, { workshopId, version });
}

async function storeFiles(workshop: WorkshopRow, scale: 1 | 2): Promise<void> {
  const board = recapBoardOf(await loadBoard(pool, workshop.id));
  const [pdf, csv] = await Promise.all([
    recapPdf({
      title: workshop.title,
      board,
      invoice: await invoiceForPdf(workshop.id),
    }),
    Promise.resolve(recapCsv(board)),
  ]);
  await putObject(objectKeys.recapPdf(workshop.id), pdf, 'application/pdf');
  await putObject(objectKeys.recapCsv(workshop.id), csv, 'text/csv; charset=utf-8');
  for (const frame of board.frames) {
    const png = await recapFramePng(board, frame, scale);
    await putObject(objectKeys.recapFramePng(workshop.id, frame.id), png, 'image/png');
  }
  await pool.query('UPDATE recaps SET files_stored_at = now() WHERE workshop_id = $1', [workshop.id]);
}

async function invoiceForPdf(
  workshopId: string,
): Promise<{ number: string; amount: string } | null> {
  const result = await pool.query<{ invoice_number: string | null; invoice_amount: string | null }>(
    'SELECT invoice_number, invoice_amount FROM recaps WHERE workshop_id = $1',
    [workshopId],
  );
  const row = result.rows[0];
  if (!row || row.invoice_number === null || row.invoice_amount === null) return null;
  return { number: row.invoice_number, amount: row.invoice_amount };
}

/**
 * Raises the sponsor invoice exactly once per workshop. An attempt that finds an invoice item
 * with this description already in Kill Bill records the existing one and never charges again.
 */
async function raiseSponsorInvoice(workshop: WorkshopRow): Promise<void> {
  const description = `Workshop ${workshop.id} — ${workshop.title}`;
  const accountId = await killbill.ensureAccount({
    name: workshop.sponsorEmail,
    externalKey: `sponsor:${workshop.sponsorEmail.toLowerCase()}`,
    email: workshop.sponsorEmail.toLowerCase(),
  });
  await pool.query(
    `INSERT INTO sponsor_accounts (external_key, kb_account_id) VALUES ($1,$2)
     ON CONFLICT (external_key) DO NOTHING`,
    [`sponsor:${workshop.sponsorEmail.toLowerCase()}`, accountId],
  );

  const existing = await killbill.findInvoiceByItemDescription(accountId, description);
  const invoice =
    existing ?? (await killbill.getInvoice(await killbill.postExternalCharge(accountId, workshop.fee, description)));
  if (invoice === null) throw new BillingUnavailable('external charge produced no invoice');

  await pool.query(
    `UPDATE recaps SET invoice_id = $2, invoice_number = $3, invoice_amount = $4, invoice_currency = $5
      WHERE workshop_id = $1 AND invoice_id IS NULL`,
    [workshop.id, invoice.id, invoice.number, workshop.fee, invoice.currency],
  );
  await recordActivity(pool, {
    facilitatorId: workshop.facilitatorId,
    actor: 'system',
    action: 'sponsor.invoiced',
    workshopId: workshop.id,
  });
}

/** The sponsor plus every invited address, with no duplicates. */
async function recapRecipients(workshopId: string, sponsorEmail: string): Promise<string[]> {
  const invited = await pool.query<{ email: string }>(
    'SELECT DISTINCT email FROM invites WHERE workshop_id = $1',
    [workshopId],
  );
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const address of [sponsorEmail.toLowerCase(), ...invited.rows.map((row) => row.email)]) {
    if (seen.has(address)) continue;
    seen.add(address);
    recipients.push(address);
  }
  return recipients;
}

/** Each recipient receives exactly one recap email, across retries and instances. */
async function sendRecapEmails(workshop: WorkshopRow, recapToken: string): Promise<void> {
  const board = recapBoardOf(await loadBoard(pool, workshop.id));
  const ranking = rankRecapClusters(board).map((entry) => ({
    frameTitle: entry.frame.title,
    title: entry.cluster.title,
    dotTotal: entry.dotTotal,
    noteTexts: entry.noteTexts,
  }));
  const invoice = await invoiceForPdf(workshop.id);
  for (const address of await recapRecipients(workshop.id, workshop.sponsorEmail)) {
    // Claiming the address first makes a repeat attempt skip an address already sent.
    const claimed = await pool.query(
      `INSERT INTO recap_emails (workshop_id, email) VALUES ($1,$2)
       ON CONFLICT (workshop_id, email) DO NOTHING`,
      [workshop.id, address],
    );
    if (claimed.rowCount === 0) continue;
    try {
      await sendMail(
        recapMail({
          to: address,
          title: workshop.title,
          recapUrl: `${config.publicBaseUrl}/recap/${recapToken}`,
          clusters: ranking,
          invoice,
        }),
      );
    } catch (error) {
      await pool.query('DELETE FROM recap_emails WHERE workshop_id = $1 AND email = $2', [
        workshop.id,
        address,
      ]);
      throw error;
    }
  }
  await pool.query('UPDATE recaps SET email_sent_at = now() WHERE workshop_id = $1', [workshop.id]);
}

/**
 * Runs one recap attempt, continuing from the first unfinished step. The recap becomes
 * complete only when every file is stored, the invoice exists or is not needed, and every
 * email is sent.
 */
export async function attemptRecap(workshopId: string | null): Promise<void> {
  const state = await claimRecap(workshopId);
  if (state === null) return;
  const workshop = await findWorkshop(pool, state.workshop_id);
  if (workshop === null) {
    await recordOutcome(state.workshop_id, null);
    return;
  }

  try {
    if (state.files_stored_at === null) {
      await storeFiles(workshop, state.scale === 2 ? 2 : 1);
    }
    if (state.invoice_id === null && !isZeroAmount(workshop.fee)) {
      await raiseSponsorInvoice(workshop);
      // The cover page quotes the invoice, so the files are rewritten once it exists.
      await storeFiles(workshop, state.scale === 2 ? 2 : 1);
    }
    await sendRecapEmails(workshop, state.recap_token);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await recordOutcome(workshop.id, 'storage_unavailable');
      return;
    }
    if (error instanceof BillingUnavailable) {
      await recordOutcome(workshop.id, 'billing_unavailable');
      return;
    }
    if (error instanceof MailUnavailable) {
      await recordOutcome(workshop.id, 'mail_unavailable');
      return;
    }
    await recordOutcome(workshop.id, null);
    throw error;
  }

  await pool.query(
    `UPDATE recaps SET status = 'complete', reason = NULL, lease_until = NULL WHERE workshop_id = $1`,
    [workshop.id],
  );
  await recordActivity(pool, {
    facilitatorId: workshop.facilitatorId,
    actor: 'system',
    action: 'recap.completed',
    workshopId: workshop.id,
  });
  await announce(workshop.id);
}

/** Starts the first attempt on the instance that accepted the close. */
export async function startRecap(workshopId: string): Promise<void> {
  try {
    await attemptRecap(workshopId);
  } catch (error) {
    process.stderr.write(`Recap attempt for ${workshopId} failed: ${(error as Error).message}\n`);
  }
}

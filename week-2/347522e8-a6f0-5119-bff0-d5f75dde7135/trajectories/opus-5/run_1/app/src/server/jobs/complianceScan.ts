/**
 * The compliance scan. It runs at start-up and every `COMPLIANCE_SCAN_SECONDS`,
 * emails a renter once when a COI or food-handler card is within fourteen days
 * of expiry and once when it lapses, and suspends an active renter whose COI or
 * card has lapsed.
 */

import { config } from '../config.js';
import { transaction, type Db } from '../db.js';
import { kitchenToday } from '../domain/clock.js';
import {
  BLOCKING_KINDS,
  isDocumentCurrent,
  isWithinExpiryNotice,
  latestApprovedOfKind,
  type DocumentFacts,
} from '../domain/compliance.js';
import {
  documentExpiredMail,
  documentExpiringMail,
  queueNotification,
} from '../services/notifications.js';
import type { RenterStatus } from '../../shared/types.js';

interface ScanRenterRow {
  id: string;
  email: string;
  status: RenterStatus;
}

async function noticeAlreadySent(
  tx: Db,
  documentId: string,
  notice: 'expiring' | 'expired',
): Promise<boolean> {
  const inserted = await tx.query<{ document_id: string }>(
    `INSERT INTO document_notices (document_id, notice) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING document_id`,
    [documentId, notice],
  );
  return inserted.length === 0;
}

export async function runComplianceScan(tx: Db): Promise<void> {
  const today = kitchenToday();
  const renters = await tx.query<ScanRenterRow>(
    "SELECT id, email, status FROM renters WHERE status <> 'offboarded' ORDER BY created_at",
  );

  for (const renter of renters) {
    const documents = await tx.query<DocumentFacts>(
      'SELECT id, kind, expires_on, status, seq::int AS seq FROM documents WHERE renter_id = $1',
      [renter.id],
    );

    let lapsed = false;
    for (const kind of BLOCKING_KINDS) {
      const latest = latestApprovedOfKind(documents, kind);
      if (!latest) {
        lapsed = true;
        continue;
      }
      if (isDocumentCurrent(latest, today)) {
        if (isWithinExpiryNotice(latest, today) && !(await noticeAlreadySent(tx, latest.id, 'expiring'))) {
          await queueNotification(
            tx,
            documentExpiringMail(renter.email, kind, latest.expires_on ?? today),
          );
        }
      } else {
        lapsed = true;
        if (!(await noticeAlreadySent(tx, latest.id, 'expired'))) {
          await queueNotification(tx, documentExpiredMail(renter.email, kind));
        }
      }
    }

    if (lapsed && renter.status === 'active') {
      await tx.query("UPDATE renters SET status = 'suspended' WHERE id = $1", [renter.id]);
    }
  }
}

export function startComplianceScan(): void {
  const tick = (): void => {
    void transaction(runComplianceScan).catch((error: unknown) => {
      process.stderr.write(`compliance scan failed: ${String(error)}\n`);
    });
  };
  tick();
  setInterval(tick, config.complianceScanSeconds * 1_000).unref();
}

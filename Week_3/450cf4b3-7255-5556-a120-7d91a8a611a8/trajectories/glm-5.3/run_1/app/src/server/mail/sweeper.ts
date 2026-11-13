import pg from 'pg';
import { Deps, inWriteTx } from '../store.js';
import { queueEmail } from '../mail/queue.js';

// The expiry notice sweeper: each current document of an approved or suspended
// tenant has two notice points, each claimed once in Postgres so any process
// sweeping the same database queues exactly one email per point.

export async function sweepExpiryNotices(deps: Deps): Promise<void> {
  await inWriteTx(deps, async (tx, now) => {
    const todayKey = deps.clock.dateKey(now);
    const r = await tx.query<{
      doc_id: string; kind: 'insurance_certificate' | 'food_handler_card'; expires_on: string;
      tenant_id: string; contact_name: string; email: string;
    }>(
      `SELECT DISTINCT ON (d.tenant_id, d.kind)
         d.id AS doc_id, d.kind, d.expires_on, d.tenant_id, u.display_name AS contact_name, u.email
       FROM documents d
       JOIN tenants t ON t.id = d.tenant_id
       JOIN users u ON u.id = t.user_id
       WHERE t.status IN ('approved','suspended')
       ORDER BY d.tenant_id, d.kind, d.uploaded_at DESC`,
    );
    const kindLabel = (kind: string) => kind === 'insurance_certificate' ? 'certificate of insurance' : 'food-handler card';
    for (const doc of r.rows) {
      const sevenDaysKey = deps.clock.addDaysKey(doc.expires_on, -7);
      const points: Array<{ point: 'seven_days' | 'today'; onKey: string; subject: string }> = [
        { point: 'seven_days', onKey: sevenDaysKey, subject: `Your ${kindLabel(doc.kind)} expires in 7 days` },
        { point: 'today', onKey: doc.expires_on, subject: `Your ${kindLabel(doc.kind)} expires today` },
      ];
      for (const p of points) {
        if (p.onKey !== todayKey) continue;
        const claim = await tx.query(
          `INSERT INTO notice_claims (document_id, point, claimed_at) VALUES ($1,$2,$3)
           ON CONFLICT (document_id, point) DO NOTHING RETURNING document_id`,
          [doc.doc_id, p.point, now],
        );
        if (claim.rows.length === 0) continue;
        const expiryDate = deps.clock.longDateFromKey(doc.expires_on);
        await queueEmail(tx, doc.tenant_id, {
          kind: `expiry_notice_${p.point}`,
          recordId: doc.doc_id,
          toName: doc.contact_name,
          toEmail: doc.email,
          subject: p.subject,
          body: [
            `Expires: ${expiryDate} at 23:59 ${deps.clock.zoneLabel()}`,
            `Bookings after ${expiryDate} will be refused until a renewed document is on file.`,
          ].join('\n'),
        }, now);
      }
    }
  });
}

export async function startSweeper(deps: Deps, db: pg.Pool): Promise<void> {
  const run = async () => {
    try {
      await sweepExpiryNotices(deps);
    } catch {
      // The next pass retries.
    }
  };
  await run();
  setInterval(run, deps.config.expirySweepSeconds * 1000);
  void db;
}

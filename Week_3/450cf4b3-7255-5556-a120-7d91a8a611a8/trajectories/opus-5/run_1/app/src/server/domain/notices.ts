import { config } from '../config';
import { query, queryOne, transactionNow, withTransaction } from '../db';
import { kitchenDate } from '../kitchen-time';
import { addDays } from '../../shared/format';
import { expiryNoticeMail, mailKindOfNotice, queueMail } from './mail';
import { nudgeMailQueue } from '../mail-worker';
import { releaseExpiredHolds } from './occupancy';
import type { DocumentKind, NoticePoint } from '../../shared/types';

interface CurrentDocumentRow {
  id: string;
  kind: DocumentKind;
  expires_on: string;
  contact_name: string;
  email: string;
}

/** Claims each notice point once in Postgres, so one email per point however many processes sweep. */
export async function sweepExpiryNotices(): Promise<void> {
  const queued = await withTransaction(async (client) => {
    const now = await transactionNow(client);
    const today = kitchenDate(now);
    const documents = await query<CurrentDocumentRow>(
      client,
      `select distinct on (d.tenant_id, d.kind)
              d.id, d.kind, d.expires_on::text as expires_on, t.contact_name, t.email
       from documents d
       join tenants t on t.id = d.tenant_id
       where t.base_status = 'approved'
       order by d.tenant_id, d.kind, d.uploaded_at desc, d.id desc`,
    );

    let count = 0;
    for (const document of documents) {
      const points: Array<{ point: NoticePoint; date: string }> = [
        { point: 'seven_days', date: addDays(document.expires_on, -7) },
        { point: 'today', date: document.expires_on },
      ];
      for (const entry of points) {
        if (entry.date !== today) continue;
        const claimed = await queryOne<{ id: string }>(
          client,
          `insert into notice_claims (document_id, point) values ($1,$2)
           on conflict (document_id, point) do nothing returning id::text as id`,
          [document.id, entry.point],
        );
        if (claimed === null) continue;
        const mail = expiryNoticeMail(document.kind, entry.point, document.expires_on);
        await queueMail(
          client,
          mailKindOfNotice(entry.point),
          document.id,
          { contactName: document.contact_name, email: document.email },
          mail.subject,
          mail.body,
        );
        count += 1;
      }
    }
    return count;
  });
  if (queued > 0) nudgeMailQueue();
}

export function startSweeps(): void {
  void sweepExpiryNotices().catch(() => undefined);
  setInterval(() => {
    void sweepExpiryNotices().catch(() => undefined);
  }, config.expirySweepSeconds * 1000).unref();

  setInterval(() => {
    void withTransaction(async (client) => {
      await releaseExpiredHolds(client, await transactionNow(client));
    }).catch(() => undefined);
  }, 10_000).unref();
}

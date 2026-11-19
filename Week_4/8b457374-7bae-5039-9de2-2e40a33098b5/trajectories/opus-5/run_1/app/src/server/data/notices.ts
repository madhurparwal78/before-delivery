import { newId } from '../domain/ids.js';
import type { Db } from './db.js';

export type NoticeKind =
  | 'pledge_receipt'
  | 'pledge_cancelled'
  | 'funded_and_charged'
  | 'not_funded'
  | 'campaign_cancelled'
  | 'fix_payment'
  | 'dropped'
  | 'settlement_ready';

export interface NoticeRow {
  id: string;
  campaign_id: string;
  person_id: string;
  kind: NoticeKind;
  to_email: string;
  subject: string;
  body: string;
  status: 'queued' | 'sent';
  created_at: Date;
  sent_at: Date | null;
}

const COLUMNS = `id, campaign_id, person_id, kind, to_email, subject, body, status, created_at, sent_at`;

/** Records a notice in the campaign's ledger. The dedupe key makes each one send once. */
export async function recordNotice(
  db: Db,
  notice: {
    campaign_id: string;
    person_id: string;
    kind: NoticeKind;
    to_email: string;
    subject: string;
    body: string;
    dedupe_key: string;
  },
): Promise<NoticeRow | null> {
  const result = await db.query<NoticeRow>(
    `insert into notices (id, campaign_id, person_id, kind, to_email, subject, body, status, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
     on conflict (dedupe_key) do nothing
     returning ${COLUMNS}`,
    [
      newId('ntc'),
      notice.campaign_id,
      notice.person_id,
      notice.kind,
      notice.to_email,
      notice.subject,
      notice.body,
      notice.dedupe_key,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listQueuedNotices(db: Db, limit: number): Promise<NoticeRow[]> {
  const result = await db.query<NoticeRow>(
    `select ${COLUMNS} from notices where status = 'queued' order by created_at limit $1`,
    [limit],
  );
  return result.rows;
}

export async function markNoticeSent(db: Db, id: string): Promise<void> {
  await db.query(`update notices set status = 'sent', sent_at = now() where id = $1`, [id]);
}

export async function listNoticesByCampaign(db: Db, campaignId: string): Promise<NoticeRow[]> {
  const result = await db.query<NoticeRow>(
    `select ${COLUMNS} from notices where campaign_id = $1 order by created_at`,
    [campaignId],
  );
  return result.rows;
}

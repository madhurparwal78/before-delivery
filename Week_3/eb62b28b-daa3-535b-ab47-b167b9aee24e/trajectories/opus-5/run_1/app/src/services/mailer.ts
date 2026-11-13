import { newId, query } from '../db';
import { deliver } from './mail';

export interface QueuedMail {
  to: string;
  subject: string;
  body: string;
  memberId?: string | null;
}

/** Every mail is written to the pending list first, so it is retried until SMTP takes it. */
export async function queueMail(mail: QueuedMail): Promise<void> {
  await query(
    'insert into pending_mail (id, member_id, to_email, subject, body) values ($1, $2, $3, $4, $5)',
    [newId(), mail.memberId ?? null, mail.to, mail.subject, mail.body],
  );
}

export async function deliverPendingMail(): Promise<void> {
  const rows = await query<{ id: string; to_email: string; subject: string; body: string }>(
    'select id, to_email, subject, body from pending_mail where sent_at is null order by created_at limit 20',
  );
  for (const row of rows) {
    try {
      await deliver({ to: row.to_email, subject: row.subject, body: row.body });
      await query('update pending_mail set sent_at = now() where id = $1', [row.id]);
    } catch {
      await query('update pending_mail set attempts = attempts + 1 where id = $1', [row.id]);
    }
  }
}

export function startMailLoop(): void {
  const tick = (): void => {
    void deliverPendingMail().finally(() => {
      setTimeout(tick, 2000);
    });
  };
  setTimeout(tick, 500);
}

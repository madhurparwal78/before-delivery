import type { Queryable } from '../domain/cart.js';

export type NoticeTemplate =
  | 'order_confirmed'
  | 'trade_in_quoted'
  | 'demo_booked'
  | 'callback_requested'
  | 'case_opened'
  | 'password_reset';

export interface NoticeDraft {
  to: string;
  template: NoticeTemplate;
  reference: string | null;
  subject: string;
  body: string;
}

/** Every notice is written to the outbox in the transaction of the action that caused it. */
export async function queueNotice(db: Queryable, draft: NoticeDraft, at: Date): Promise<void> {
  await db.query(
    `INSERT INTO notices (to_email, template, reference, subject, body, status, attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 0, $6, $7)`,
    [draft.to, draft.template, draft.reference, draft.subject, draft.body, new Date(), at],
  );
}

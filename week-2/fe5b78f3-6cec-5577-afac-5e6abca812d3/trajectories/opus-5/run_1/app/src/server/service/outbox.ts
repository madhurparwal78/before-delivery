import type { Transaction } from '../db/pool';

export interface QueuedMail {
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly attachPnr?: string;
  readonly attachVersion?: number;
}

/** Mail is written to the outbox in the same change as its event, and sent from there once. */
export async function queueMail(tx: Transaction, mail: QueuedMail): Promise<void> {
  await tx.query(
    `insert into outbox (dedupe_key, to_email, subject, body, attach_pnr, attach_version)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (dedupe_key) do nothing`,
    [
      mail.dedupeKey,
      mail.to,
      mail.subject,
      mail.body,
      mail.attachPnr ?? null,
      mail.attachVersion ?? null,
    ],
  );
}

import { config } from '../config.js';
import { nowDate } from '../clock.js';
import { db, tx, type Queryable } from '../db.js';
import { sendLetter } from './smtp.js';

export type OutboxKind = 'invite' | 'mention' | 'digest';

export type QueuedMail = {
  workspaceId: string;
  to: string;
  subject: string;
  body: string;
  kind: OutboxKind;
  inviteId?: string;
  messageId?: number;
  personId?: string;
  channelId?: string;
  digestDate?: string;
};

export async function queueMail(client: Queryable, mail: QueuedMail): Promise<void> {
  await client.query(
    `insert into outbox (workspace_id, to_email, subject, body, kind, invite_id, message_id, person_id, channel_id, digest_date, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      mail.workspaceId,
      mail.to,
      mail.subject,
      mail.body,
      mail.kind,
      mail.inviteId ?? null,
      mail.messageId ?? null,
      mail.personId ?? null,
      mail.channelId ?? null,
      mail.digestDate ?? null,
      nowDate().toISOString(),
    ],
  );
}

export async function heldMailCount(workspaceId: string | null): Promise<number> {
  const row =
    workspaceId === null
      ? await db.one<{ count: number }>('select count(*)::int as count from outbox where sent_at is null')
      : await db.one<{ count: number }>(
          'select count(*)::int as count from outbox where sent_at is null and workspace_id = $1',
          [workspaceId],
        );
  return row?.count ?? 0;
}

let lastAttemptFailed = false;

export function mailDeliveryFailing(): boolean {
  return lastAttemptFailed;
}

type OutboxRow = {
  id: number;
  workspace_id: string;
  to_email: string;
  subject: string;
  body: string;
  kind: OutboxKind;
};

/**
 * Delivers held mail. The claimed rows stay locked until SMTP has accepted them
 * and the row is marked sent, so copies sharing a database each send once.
 */
export async function deliverHeldMail(): Promise<void> {
  let sentAny = false;
  try {
    const delivered = await tx(async (client) => {
      const rows = await client.query<OutboxRow>(
        `select o.id, o.workspace_id, o.to_email, o.subject, o.body, o.kind
           from outbox o
           left join invites i on i.id = o.invite_id
          where o.sent_at is null
            and (o.invite_id is null or i.status = 'pending')
          order by o.id
          limit 10
          for update of o skip locked`,
      );
      let count = 0;
      for (const row of rows) {
        await sendLetter(config.smtpHost, config.smtpPort, {
          from: config.mailFrom,
          to: row.to_email,
          subject: row.subject,
          body: row.body,
          headers: { 'X-Tallyroom-Workspace': row.workspace_id },
          sentAt: nowDate(),
        });
        await client.query('update outbox set sent_at = $2, attempts = attempts + 1 where id = $1', [
          row.id,
          nowDate().toISOString(),
        ]);
        count += 1;
      }
      return count;
    });
    sentAny = delivered > 0;
    lastAttemptFailed = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mail failed';
    lastAttemptFailed = true;
    await db
      .query(
        `update outbox set attempts = attempts + 1, last_error = $1, claimed_at = $2
          where sent_at is null and id in (select id from outbox where sent_at is null order by id limit 10)`,
        [message, nowDate().toISOString()],
      )
      .catch(() => undefined);
  }
  if (sentAny) await pruneSentMail();
}

async function pruneSentMail(): Promise<void> {
  await db
    .query('delete from outbox where sent_at is not null and sent_at < $1', [
      new Date(nowDate().getTime() - 86400000).toISOString(),
    ])
    .catch(() => undefined);
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `Friday 30 October`, as the digest subject prints a date. */
export function longDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = weekdayNames[parsed.getUTCDay()] ?? '';
  const month = monthNames[parsed.getUTCMonth()] ?? '';
  return `${weekday} ${parsed.getUTCDate()} ${month}`;
}

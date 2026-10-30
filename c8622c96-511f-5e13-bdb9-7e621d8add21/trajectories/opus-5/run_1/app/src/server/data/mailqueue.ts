import { randomUUID } from 'node:crypto';
import { displayMoney } from '../../domain/money.js';
import { displayCoopTime } from '../../domain/time.js';
import { queryOn, type Queryable } from '../db/pool.js';

export type MailKind = 'embargo_lift' | 'licence_receipt' | 'expiry_warning' | 'takedown_notice';

export interface QueuedMail {
  dedupeKey: string;
  kind: MailKind;
  essayId: string | null;
  licenceId: string | null;
  toEmail: string;
  subject: string;
  body: string;
}

export async function queueMail(client: Queryable, mail: QueuedMail, now: Date): Promise<void> {
  await queryOn(
    client,
    `insert into outbound_mail
       (id, dedupe_key, kind, essay_id, licence_id, to_email, subject, body, state, next_attempt_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', now(), $9)
     on conflict (dedupe_key) do nothing`,
    [
      randomUUID(),
      mail.dedupeKey,
      mail.kind,
      mail.essayId,
      mail.licenceId,
      mail.toEmail,
      mail.subject,
      mail.body,
      now,
    ],
  );
}

export async function cancelEssayMail(client: Queryable, essayId: string, kinds: MailKind[]): Promise<void> {
  await queryOn(
    client,
    `update outbound_mail set state = 'cancelled'
     where essay_id = $1 and state = 'queued' and kind = any($2::text[])`,
    [essayId, kinds],
  );
}

export function embargoLiftMail(essay: { id: string; title: string; creditLine: string; liftAt: Date }, recipient: { id: string; email: string }): QueuedMail {
  return {
    dedupeKey: `embargo_lift:${essay.id}:${recipient.id}`,
    kind: 'embargo_lift',
    essayId: essay.id,
    licenceId: null,
    toEmail: recipient.email,
    subject: `Embargo lifted: ${essay.title}`,
    body: [
      `The embargo has lifted on ${essay.title}.`,
      essay.creditLine,
      `Embargo lift: ${displayCoopTime(essay.liftAt)}`,
      '',
      'Saltprint Picture Co-operative',
    ].join('\n'),
  };
}

export function licenceReceiptMail(
  licence: {
    id: string;
    essayId: string;
    essayTitle: string;
    creditLine: string;
    kind: 'exclusive' | 'standard';
    windowStart: Date;
    windowEnd: Date;
    amountMinor: number;
  },
  recipient: { id: string; email: string },
): QueuedMail {
  return {
    dedupeKey: `licence_receipt:${licence.id}:${recipient.id}`,
    kind: 'licence_receipt',
    essayId: licence.essayId,
    licenceId: licence.id,
    toEmail: recipient.email,
    subject: `Licence receipt: ${licence.essayTitle}`,
    body: [
      `Licence confirmed for ${licence.essayTitle}.`,
      licence.creditLine,
      `Kind: ${licence.kind}`,
      `Window start: ${displayCoopTime(licence.windowStart)}`,
      `Window end: ${displayCoopTime(licence.windowEnd)}`,
      `Amount: ${displayMoney(licence.amountMinor)} USD`,
      `Licence: ${licence.id}`,
      '',
      'Saltprint Picture Co-operative',
    ].join('\n'),
  };
}

export function expiryWarningMail(
  licence: {
    id: string;
    essayId: string;
    essayTitle: string;
    kind: 'exclusive' | 'standard';
    windowEnd: Date;
  },
  recipient: { id: string; email: string },
): QueuedMail {
  return {
    dedupeKey: `expiry_warning:${licence.id}:${recipient.id}`,
    kind: 'expiry_warning',
    essayId: licence.essayId,
    licenceId: licence.id,
    toEmail: recipient.email,
    subject: `Licence ending in 24 hours: ${licence.essayTitle}`,
    body: [
      `Your licence for ${licence.essayTitle} ends in 24 hours.`,
      `Kind: ${licence.kind}`,
      `Window end: ${displayCoopTime(licence.windowEnd)}`,
      `Licence: ${licence.id}`,
      '',
      'Saltprint Picture Co-operative',
    ].join('\n'),
  };
}

export function takedownNoticeMail(
  essay: { id: string; title: string },
  revokedLicenceIds: string[],
  recipient: { id: string; email: string },
): QueuedMail {
  return {
    dedupeKey: `takedown_notice:${essay.id}:${recipient.id}`,
    kind: 'takedown_notice',
    essayId: essay.id,
    licenceId: null,
    toEmail: recipient.email,
    subject: `Takedown notice: ${essay.title}`,
    body: [
      `${essay.title} has been taken down after a legal request.`,
      `Revoked licences: ${revokedLicenceIds.join(', ')}`,
      'Stop all use of this essay and delete stored copies.',
      '',
      'Saltprint Picture Co-operative',
    ].join('\n'),
  };
}

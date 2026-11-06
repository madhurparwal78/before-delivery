import { randomUUID } from 'node:crypto';
import { privateCopy } from '../domain/privateCopy.js';
import type { Language } from '../domain/privateCopy.js';
import { config, MAIL_ADDRESS } from './config.js';
import { query } from './infra/db.js';
import type { MailAttachment } from './infra/smtp.js';

export type QueuedMail = {
  clientId: string | null;
  recipient: string;
  subject: string;
  body: string;
  attachments?: MailAttachment[];
  sendAfter?: Date;
};

/** All mail goes through the pending mail in Postgres, each message once. */
export async function queueMail(mail: QueuedMail): Promise<void> {
  await query(
    `insert into mail_queue (id, client_id, recipient, subject, body, attachments,
                             send_after, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,now())`,
    [
      randomUUID(),
      mail.clientId,
      mail.recipient,
      mail.subject,
      mail.body,
      JSON.stringify(mail.attachments ?? []),
      mail.sendAfter ?? new Date(),
    ],
  );
}

export function publicAddress(path: string): string {
  return `${config.publicUrl.replace(/\/$/, '')}${path}`;
}

/** A review or reminder mail: job title, full private address and the due line. */
export function reviewMailBody(
  language: Language,
  jobTitle: string,
  token: string,
  dueDate: string,
): string {
  return [
    privateCopy('reviewHeading', language, { title: jobTitle }),
    publicAddress(`/r/${token}`),
    privateCopy('mailDueLine', language, { date: dueDate }),
  ].join('\n\n');
}

export function signOffMailBody(
  language: Language,
  jobTitle: string,
  token: string,
  dueDate: string,
): string {
  return [
    privateCopy('signOffHeading', language, { title: jobTitle }),
    publicAddress(`/s/${token}`),
    privateCopy('mailDueLine', language, { date: dueDate }),
  ].join('\n\n');
}

export function newLinkMailBody(language: Language, paths: readonly string[]): string {
  return [
    privateCopy('mailNewLinkSubject', language),
    ...paths.map((path) => publicAddress(path)),
  ].join('\n\n');
}

export function enquiryMail(fields: {
  name: string;
  email: string;
  phone: string;
  message: string;
}): QueuedMail {
  return {
    clientId: null,
    recipient: MAIL_ADDRESS,
    subject: `Enquiry from ${fields.name}`,
    body: [
      `Name: ${fields.name}`,
      `Email: ${fields.email}`,
      `Phone: ${fields.phone}`,
      `Message: ${fields.message}`,
    ].join('\n'),
  };
}

import { config } from '../config';
import { query } from '../db/pool';
import { LISBON, localTime, shownDate } from '../domain/time';
import {
  answerDueLine,
  mailAsk,
  mailGreeting,
  mailSubject,
} from '../domain/copy';
import type { Language } from '../domain/numbers';
import { newId, nextSortIndex } from '../ids';

async function queueMail(message: {
  labelId: string | null;
  recipient: string;
  subject: string;
  body: string;
  sendAfter: number;
}): Promise<void> {
  await query(
    `insert into mail_outbox (id, label_id, recipient, subject, body, send_after, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [newId(), message.labelId, message.recipient, message.subject, message.body, message.sendAfter, nextSortIndex()],
  );
}

/** A request or reminder mail, carrying no footprint figure and no other name. */
export async function queueRequestMail(
  kind: 'request' | 'reminder',
  details: {
    labelId: string;
    labelName: string;
    styleName: string;
    contactName: string;
    contactEmail: string;
    language: Language;
    token: string;
    dueDate: string;
    townName: string;
    sendAfter: number;
  },
): Promise<void> {
  const address = `${config.publicUrl}/a/${details.token}`;
  const body = [
    mailGreeting[details.language](details.contactName),
    '',
    mailAsk[details.language](details.labelName, details.styleName),
    '',
    address,
    '',
    answerDueLine[details.language](details.dueDate, details.townName),
    '',
  ].join('\n');
  await queueMail({
    labelId: details.labelId,
    recipient: `${details.contactName} <${details.contactEmail}>`,
    subject: mailSubject[kind][details.language](details.labelName),
    body,
    sendAfter: details.sendAfter,
  });
}

/** The sign-off mail, carrying no supplier contact details. */
export async function queueSignOffMail(details: {
  labelId: string;
  contactName: string;
  contactEmail: string;
  styleName: string;
  token: string;
  endsAt: number;
  sendAfter: number;
}): Promise<void> {
  const address = `${config.publicUrl}/s/${details.token}`;
  const body = [
    mailGreeting.en(details.contactName),
    '',
    `Please read and sign off the dossier for ${details.styleName} on this private page:`,
    '',
    address,
    '',
    `This page ends on ${shownDate(details.endsAt, LISBON)}, ${localTime(details.endsAt, LISBON)} Lisbon time.`,
    '',
  ].join('\n');
  await queueMail({
    labelId: details.labelId,
    recipient: `${details.contactName} <${details.contactEmail}>`,
    subject: `Dossier to sign off: ${details.styleName}`,
    body,
    sendAfter: details.sendAfter,
  });
}

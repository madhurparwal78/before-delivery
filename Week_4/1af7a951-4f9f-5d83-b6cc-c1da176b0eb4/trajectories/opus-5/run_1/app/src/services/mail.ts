import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { apiError, type ApiError } from '../http/errors.js';
import { centsToDollars } from '../domain/time.js';
import { SIGN_CATEGORIES, type Tallies } from '../domain/signs.js';
import type { RosterRow } from '../store/aggregates.js';
import { SmtpError, deliver } from './smtp.js';

export class MailUnavailableError extends Error {}

export function mailOutage(): ApiError {
  return apiError(503, 'mail_unavailable');
}

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

function encodedHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled?.[1] ?? from;
}

function messageData(message: Message): string {
  const body = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodedHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@lanternfish>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

export async function send(message: Message): Promise<void> {
  try {
    await deliver(
      config.mail.host,
      config.mail.port,
      envelopeAddress(config.mail.from),
      message.to,
      messageData(message),
    );
  } catch (error) {
    if (error instanceof SmtpError) throw new MailUnavailableError(error.message);
    throw error;
  }
}

export interface ReceiptFacts {
  readonly email: string;
  readonly cohortName: string;
  readonly firstNight: string;
  readonly bedtime: string;
  readonly wakeAlarm: string;
  readonly amountPaidCents: number;
  readonly enrollmentId: string;
  readonly accessCode: string;
}

export function receiptMessage(facts: ReceiptFacts): Message {
  return {
    to: facts.email,
    subject: `Your Lanternfish seat in ${facts.cohortName} is confirmed`,
    text: [
      `Cohort: ${facts.cohortName}`,
      `First night: ${facts.firstNight}`,
      `Bedtime: ${facts.bedtime}`,
      `Wake alarm: ${facts.wakeAlarm}`,
      `Amount paid: $${centsToDollars(facts.amountPaidCents)}`,
      `Enrollment: ${facts.enrollmentId}`,
      `Access code: ${facts.accessCode}`,
    ].join('\n'),
  };
}

function signsPhrase(tallies: Tallies): string {
  return `inner awareness ${tallies.inner_awareness} / action ${tallies.action} / form ${tallies.form} / context ${tallies.context}`;
}

export function digestMessage(
  coachEmail: string,
  cohortName: string,
  week: number,
  dreamers: readonly RosterRow[],
): Message {
  const total: Tallies = { inner_awareness: 0, action: 0, form: 0, context: 0 };
  const lines = dreamers.map((dreamer) => {
    for (const category of SIGN_CATEGORIES) total[category] += dreamer.sign_tallies[category];
    const percent = Math.round(dreamer.recall_rate * 100);
    return `${dreamer.display_name}: recall ${percent}%, technique ${dreamer.technique_minutes} min, WBTB nights ${dreamer.wbtb_nights}, reality checks ${dreamer.reality_checks}, signs ${signsPhrase(dreamer.sign_tallies)}`;
  });
  return {
    to: coachEmail,
    subject: `Lanternfish digest: ${cohortName}, week ${week}`,
    text: [...lines, `Cohort signs: ${signsPhrase(total)}`].join('\n'),
  };
}

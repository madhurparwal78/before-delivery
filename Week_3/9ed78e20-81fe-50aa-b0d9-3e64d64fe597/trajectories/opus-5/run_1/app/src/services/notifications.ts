import { config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { STAGE_LABELS, type ApplicationStage } from '../domain/lifecycle.js';
import { formatLondonDateTime } from '../domain/london.js';
import type { StaffRole } from '../domain/roles.js';
import { ROLE_LABELS } from '../domain/roles.js';
import { queueJob } from './jobs.js';
import type { Recipient } from './mail.js';

export function trackingUrl(token: string): string {
  return `${config.publicBaseUrl}/track/${token}`;
}

async function queueMail(
  tx: Queryable,
  to: Recipient,
  subject: string,
  text: string,
  dedupeKey?: string,
): Promise<void> {
  await queueJob(tx, 'mail', { to, subject, text }, dedupeKey);
}

export async function queueApplicationReceipt(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly roleTitle: string;
    readonly reference: string;
    readonly token: string;
  },
): Promise<void> {
  const text = [
    `Dear ${input.to.name},`,
    '',
    `We have received your application for ${input.roleTitle} at Aldermoor Labs.`,
    `Your reference is ${input.reference}.`,
    '',
    'You can follow your application here:',
    trackingUrl(input.token),
    '',
    'Aldermoor Labs, the open record.',
  ].join('\n');
  await queueMail(tx, input.to, `Application received: ${input.roleTitle}`, text);
}

export async function queueStageNotice(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly roleTitle: string;
    readonly stage: ApplicationStage;
    readonly token: string | null;
  },
): Promise<void> {
  const lines = [
    `Dear ${input.to.name},`,
    '',
    `There is an update on your application for ${input.roleTitle}.`,
    `Your application is now at: ${STAGE_LABELS[input.stage]}.`,
  ];
  if (input.token !== null) {
    lines.push('', 'Follow your application here:', trackingUrl(input.token));
  }
  lines.push('', 'Aldermoor Labs, the open record.');
  await queueMail(tx, input.to, 'Update on your Aldermoor application', lines.join('\n'));
}

export async function queueResentLinks(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly applications: readonly { readonly roleTitle: string; readonly token: string }[];
  },
): Promise<void> {
  const lines = [
    `Dear ${input.to.name},`,
    '',
    'Here are the tracking links for your applications with Aldermoor Labs.',
    '',
    ...input.applications.map((entry) => `${entry.roleTitle}: ${trackingUrl(entry.token)}`),
    '',
    'Any earlier links have stopped working.',
    '',
    'Aldermoor Labs, the open record.',
  ];
  await queueMail(tx, input.to, 'Your Aldermoor application links', lines.join('\n'));
}

export async function queueReissuedLink(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly roleTitle: string;
    readonly token: string;
  },
): Promise<void> {
  const text = [
    `Dear ${input.to.name},`,
    '',
    `Here is a new tracking link for your application for ${input.roleTitle}.`,
    '',
    trackingUrl(input.token),
    '',
    'Any earlier link has stopped working.',
    '',
    'Aldermoor Labs, the open record.',
  ].join('\n');
  await queueMail(tx, input.to, `Your new tracking link: ${input.roleTitle}`, text);
}

export async function queueSignoffRequest(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly title: string;
    readonly contentId: string;
  },
): Promise<void> {
  const text = [
    `Dear ${input.to.name},`,
    '',
    `The model route "${input.title}" is in review and its release record awaits sign-off.`,
    '',
    `${config.publicBaseUrl}/console/content/${input.contentId}`,
    '',
    'Aldermoor Labs, the open record.',
  ].join('\n');
  await queueMail(tx, input.to, `Release record awaiting sign-off: ${input.title}`, text);
}

export async function queueGrantExpiryNotice(
  tx: Queryable,
  input: {
    readonly to: Recipient;
    readonly grantId: string;
    readonly role: StaffRole;
    readonly expiresAt: Date;
  },
): Promise<void> {
  const label = ROLE_LABELS[input.role];
  const text = [
    `Dear ${input.to.name},`,
    '',
    `Your ${label} access to the Aldermoor console ends on ${formatLondonDateTime(
      input.expiresAt,
    )} London.`,
    '',
    'Ask an administrator for a new grant if you still need it.',
    '',
    'Aldermoor Labs, the open record.',
  ].join('\n');
  await queueMail(
    tx,
    input.to,
    `Your ${label} access ends soon`,
    text,
    `grant-expiry:${input.grantId}`,
  );
}

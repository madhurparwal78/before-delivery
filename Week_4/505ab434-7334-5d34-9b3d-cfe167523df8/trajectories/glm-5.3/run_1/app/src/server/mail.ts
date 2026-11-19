import type { Tx } from './db';
import { formatDay, formatTime, formatDateTime } from './datetime';
import type { Config } from './config';

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

/** Writes one notice into the outbox inside the caller's transaction. */
export async function queueMail(tx: Tx, draft: MailDraft, now: Date): Promise<void> {
  await tx.query('INSERT INTO mail_outbox (to_email, subject, body, created_at) VALUES ($1,$2,$3,$4)', [
    draft.to,
    draft.subject,
    draft.body,
    now,
  ]);
}

export function requestUrl(cfg: Config, requestId: string): string {
  return `${trimSlash(cfg.appPublicUrl)}/requests/${requestId}`;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

export function invitationMail(cfg: Config, token: string, expiresAt: Date, to: string): MailDraft {
  const url = `${trimSlash(cfg.appPublicUrl)}/activate/${token}`;
  return {
    to,
    subject: 'Your Rulehouse invitation',
    body: [
      'Activate your Rulehouse account.',
      '',
      url,
      '',
      `This link works once and expires on ${formatDay(expiresAt, cfg.appTimeZone)} at ${formatTime(expiresAt, cfg.appTimeZone)}.`,
    ].join('\n'),
  };
}

export function stageAssignedMail(
  cfg: Config,
  requestId: string,
  cardName: string,
  stageReason: string,
  deadline: Date,
  to: string,
): MailDraft {
  return {
    to,
    subject: `Review needed: ${requestId} ${cardName}`,
    body: [
      `${requestId} ${cardName} needs your review.`,
      '',
      stageReason,
      `Due ${formatDateTime(deadline, cfg.appTimeZone)}`,
      '',
      requestUrl(cfg, requestId),
    ].join('\n'),
  };
}

export function warningMail(cfg: Config, requestId: string, deadline: Date, to: string): MailDraft {
  return {
    to,
    subject: `Deadline soon: ${requestId}`,
    body: [
      `${requestId} is due soon.`,
      '',
      `Due ${formatDateTime(deadline, cfg.appTimeZone)}`,
      '',
      requestUrl(cfg, requestId),
    ].join('\n'),
  };
}

export function breachMail(cfg: Config, requestId: string, previousHolderName: string, to: string): MailDraft {
  return {
    to,
    subject: `Deadline missed: ${requestId} is now yours`,
    body: [
      `${requestId} missed its deadline and is now yours.`,
      '',
      `Previous holder: ${previousHolderName}`,
      '',
      requestUrl(cfg, requestId),
    ].join('\n'),
  };
}

export function decisionMail(
  cfg: Config,
  requestId: string,
  stateLabel: string,
  comment: string | null,
  to: string,
): MailDraft {
  const lines = [`${requestId} is now ${stateLabel}.`];
  if (comment) lines.push('', comment);
  lines.push('', requestUrl(cfg, requestId));
  return { to, subject: `Decision on ${requestId}: ${stateLabel}`, body: lines.join('\n') };
}

export function zeroLengthMail(cfg: Config, requestId: string, to: string): MailDraft {
  return {
    to,
    subject: `Decision on ${requestId}: Granted`,
    body: [
      `${requestId} is now Granted.`,
      '',
      `This grant ended before it started, so nothing can be downloaded.`,
      '',
      requestUrl(cfg, requestId),
    ].join('\n'),
  };
}

export function grantMail(
  cfg: Config,
  requestId: string,
  grantId: string,
  cardName: string,
  endsOn: string,
  statusLabel: string,
  conditionTexts: string[],
  to: string,
): MailDraft {
  const lines = [
    `Grant ${grantId} on ${cardName}`,
    `Ends ${formatDay(endsOn, cfg.appTimeZone)}`,
    `Status: ${statusLabel}`,
  ];
  if (conditionTexts.length > 0) lines.push('', ...conditionTexts);
  lines.push('', requestUrl(cfg, requestId));
  return {
    to,
    subject: `Granted: ${requestId} until ${formatDay(endsOn, cfg.appTimeZone)}`,
    body: lines.join('\n'),
  };
}

export function revokedMail(grantId: string, reason: string, to: string): MailDraft {
  return {
    to,
    subject: `Grant ${grantId} revoked`,
    body: [`Grant ${grantId} was revoked.`, '', reason].join('\n'),
  };
}

export function expiredMail(cfg: Config, requestId: string, to: string): MailDraft {
  return {
    to,
    subject: `Decision on ${requestId}: Expired`,
    body: [`${requestId} is now Expired.`, '', requestUrl(cfg, requestId)].join('\n'),
  };
}

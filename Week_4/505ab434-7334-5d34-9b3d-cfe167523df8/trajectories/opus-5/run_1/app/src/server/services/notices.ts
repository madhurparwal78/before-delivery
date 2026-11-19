import { config } from '../config.js';
import type { Notice } from '../mail.js';
import { formatDisplayDate, formatDisplayDateTime, formatDisplayTime } from '../time.js';

const requestUrl = (requestId: string): string => `${config.publicUrl}/requests/${requestId}`;

export const notices = {
  invitation(email: string, token: string, expiresAt: Date): Notice {
    return {
      to: email,
      subject: 'Your Rulehouse invitation',
      body: [
        'You have been invited to Rulehouse for Quenby & Co.',
        '',
        `${config.publicUrl}/activate/${token}`,
        '',
        `This link works once and expires on ${formatDisplayDate(expiresAt)} at ${formatDisplayTime(expiresAt)}.`,
      ].join('\n'),
    };
  },

  stageAssigned(
    email: string,
    requestId: string,
    cardName: string,
    reason: string,
    deadline: Date,
  ): Notice {
    return {
      to: email,
      subject: `Review needed: ${requestId} ${cardName}`,
      body: [reason, `Due ${formatDisplayDateTime(deadline)}`, '', requestUrl(requestId)].join('\n'),
    };
  },

  deadlineWarning(email: string, requestId: string, deadline: Date): Notice {
    return {
      to: email,
      subject: `Deadline soon: ${requestId}`,
      body: [`Due ${formatDisplayDateTime(deadline)}`, '', requestUrl(requestId)].join('\n'),
    };
  },

  deadlineMissed(email: string, requestId: string, previousHolderName: string): Notice {
    return {
      to: email,
      subject: `Deadline missed: ${requestId} is now yours`,
      body: [
        `${requestId} passed its deadline while held by ${previousHolderName}.`,
        '',
        requestUrl(requestId),
      ].join('\n'),
    };
  },

  decision(email: string, requestId: string, stateLabel: string, detail: string | null, zeroLength: boolean): Notice {
    const lines = [`${requestId} is now ${stateLabel}.`];
    if (detail) lines.push('', detail);
    if (zeroLength) lines.push('', 'This grant ended before it started, so nothing can be downloaded.');
    lines.push('', requestUrl(requestId));
    return { to: email, subject: `Decision on ${requestId}: ${stateLabel}`, body: lines.join('\n') };
  },

  granted(
    email: string,
    requestId: string,
    grantId: string,
    cardName: string,
    notAfter: string,
    statusLabel: string,
    conditionTexts: string[],
  ): Notice {
    const lines = [
      `Grant ${grantId} on ${cardName}`,
      `Ends ${formatDisplayDate(notAfter)}`,
      `Status: ${statusLabel}`,
      ...conditionTexts,
      '',
      requestUrl(requestId),
    ];
    return {
      to: email,
      subject: `Granted: ${requestId} until ${formatDisplayDate(notAfter)}`,
      body: lines.join('\n'),
    };
  },

  grantRevoked(email: string, grantId: string, reason: string, requestId: string | null): Notice {
    const lines = [`Grant ${grantId} was revoked.`, '', reason];
    if (requestId) lines.push('', requestUrl(requestId));
    return { to: email, subject: `Grant ${grantId} revoked`, body: lines.join('\n') };
  },
};

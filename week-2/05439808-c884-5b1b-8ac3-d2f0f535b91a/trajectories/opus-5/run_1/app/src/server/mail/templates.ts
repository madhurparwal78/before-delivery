import { config } from '../config.js';
import type { OutgoingMail } from './smtp.js';

export const CONFIRM_SUBJECT = 'Confirm your Saltreach email';
export const RESET_SUBJECT = 'Reset your Saltreach password';

function link(path: string): string {
  return `${config.publicUrl}${path}`;
}

export function confirmationMail(to: string, token: string): OutgoingMail {
  return {
    to,
    subject: CONFIRM_SUBJECT,
    body: [
      'Welcome to Saltreach.',
      '',
      'Confirm your email to finish raising your island:',
      link(`/verify?token=${token}`),
      '',
      'The link works once and expires soon.'
    ].join('\n')
  };
}

export function alreadyVerifiedMail(to: string): OutgoingMail {
  return {
    to,
    subject: CONFIRM_SUBJECT,
    body: [
      `The address ${to} already has a confirmed Saltreach account.`,
      '',
      `Sign in: ${link('/signin')}`,
      `Forgot your password: ${link('/forgot')}`
    ].join('\n')
  };
}

export function noAccountConfirmationMail(to: string): OutgoingMail {
  return {
    to,
    subject: CONFIRM_SUBJECT,
    body: [
      `No Saltreach account uses ${to}.`,
      '',
      `Make an island: ${link('/signup')}`
    ].join('\n')
  };
}

export function resetMail(to: string, token: string): OutgoingMail {
  return {
    to,
    subject: RESET_SUBJECT,
    body: [
      'Set a new Saltreach password here:',
      link(`/reset?token=${token}`),
      '',
      'The link works once and expires soon.'
    ].join('\n')
  };
}

export function noAccountResetMail(to: string): OutgoingMail {
  return {
    to,
    subject: RESET_SUBJECT,
    body: [
      `No Saltreach account uses ${to}, so there is no password to reset.`,
      '',
      `Make an island: ${link('/signup')}`
    ].join('\n')
  };
}

export function invitationMail(
  to: string,
  inviterName: string,
  clanName: string,
  hasAccount: boolean
): OutgoingMail {
  const lines = [
    `${inviterName} invited you to ${clanName} on Saltreach.`,
    '',
    'Open the Clan panel on your island and accept the invitation there.'
  ];
  if (!hasAccount) {
    lines.push('', `Make an island first: ${link('/signup')}`);
  }
  return {
    to,
    subject: `${inviterName} invited you to ${clanName} on Saltreach`,
    body: lines.join('\n')
  };
}

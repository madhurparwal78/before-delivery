import type { App, User } from './app.ts';

/** Dunning emails, sent from the scheduled retry worker and the API. */

export async function sendFirstDunning(app: App, user: User): Promise<void> {
  await app.mail.enqueue({
    toEmail: user.email,
    toName: user.name,
    subject: "Your supporter payment didn't go through",
    body: [
      `Hello ${user.name},`,
      '',
      "Your supporter payment didn't go through. Please update your card and retry the payment.",
      '',
      'Halden Reading Room',
    ].join('\n'),
    dedupeKey: `dunning:first:${user.id}`,
  });
}

export async function sendDunningReminder(app: App, user: User, attempt: number): Promise<void> {
  await app.mail.enqueue({
    toEmail: user.email,
    toName: user.name,
    subject: 'Reminder: your supporter payment is still due',
    body: [
      `Hello ${user.name},`,
      '',
      'Reminder: your supporter payment is still due.',
      '',
      'Halden Reading Room',
    ].join('\n'),
    dedupeKey: `dunning:reminder:${user.id}:${attempt}`,
  });
}

export async function sendDunningCancellation(app: App, user: User): Promise<void> {
  await app.mail.enqueue({
    toEmail: user.email,
    toName: user.name,
    subject: 'Your supporter membership has been cancelled',
    body: [
      `Hello ${user.name},`,
      '',
      'Your supporter membership has been cancelled.',
      '',
      'Halden Reading Room',
    ].join('\n'),
    dedupeKey: `dunning:cancelled:${user.id}`,
  });
}

export const MailQueueEn = { sendFirstDunning };

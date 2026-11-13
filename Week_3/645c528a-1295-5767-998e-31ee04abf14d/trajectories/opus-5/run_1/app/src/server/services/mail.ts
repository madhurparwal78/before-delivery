import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { deliver, smtpReachable } from './smtp.js';

export type Receipt = 'sent' | 'delayed';

async function send(to: string, subject: string, body: string): Promise<boolean> {
  try {
    await deliver({ to, subject, text: body });
    return true;
  } catch {
    return false;
  }
}

/** Sends now, and stores the message in Postgres for retries when the mail server refuses it. */
async function sendOrStore(input: {
  playerId: string;
  kind: 'verification' | 'receipt';
  to: string;
  subject: string;
  body: string;
}): Promise<Receipt> {
  if (await send(input.to, input.subject, input.body)) return 'sent';
  await query(`INSERT INTO mail_outbox (id, player_id, kind, to_email, subject, body) VALUES ($1,$2,$3,$4,$5,$6)`, [
    randomUUID(),
    input.playerId,
    input.kind,
    input.to,
    input.subject,
    input.body,
  ]).catch(() => []);
  return 'delayed';
}

export function verificationBody(origin: string, token: string): string {
  return `Welcome to Long Rail Headstring.\n\nVerify your email: ${origin}/verify?token=${token}\n`;
}

export async function sendVerification(playerId: string, email: string, token: string, origin: string): Promise<Receipt> {
  return sendOrStore({
    playerId,
    kind: 'verification',
    to: email,
    subject: 'Verify your Long Rail email',
    body: verificationBody(origin, token),
  });
}

export async function sendReceipt(input: {
  playerId: string;
  email: string;
  packName: string;
  cash: number;
  priceUsd: string;
  paymentId: string;
}): Promise<Receipt> {
  return sendOrStore({
    playerId: input.playerId,
    kind: 'receipt',
    to: input.email,
    subject: 'Your Long Rail receipt',
    body: `Thank you for your purchase.\n\nPack: ${input.packName}\nCash: ${input.cash} Cash\nPrice: $${input.priceUsd}\nKill Bill payment id: ${input.paymentId}\n`,
  });
}

export async function retryOutbox(): Promise<void> {
  const rows = await query<{ id: string; to_email: string; subject: string; body: string }>(
    `SELECT id, to_email, subject, body FROM mail_outbox WHERE delivered = FALSE ORDER BY created_at LIMIT 20`,
  ).catch(() => []);
  for (const row of rows) {
    if (await send(row.to_email, row.subject, row.body)) {
      await query(`UPDATE mail_outbox SET delivered = TRUE WHERE id = $1`, [row.id]).catch(() => []);
    }
  }
}

export async function mailReachable(): Promise<boolean> {
  return smtpReachable();
}

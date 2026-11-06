import { randomBytes, createHash } from 'node:crypto';
import { pool } from './db.js';
import { ritualTitle } from '../shared/plan.js';

const linkToken = () => randomBytes(24).toString('base64url');
export const shareToken = () => randomBytes(18).toString('base64url');
export const sessionToken = () => randomBytes(32).toString('base64url');
export const hourId = () => randomBytes(12).toString('base64url');
export const outboxId = () => randomBytes(12).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface Exec {
  query(sql: string, params?: readonly unknown[]): Promise<{ rowCount: number | null }>;
}

export const poolExec: Exec = pool;

export interface QueuedEmail {
  id: string;
  email: string;
  kind: string;
  subject: string;
  body_text: string;
  body_html: string;
  link_token: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlWrap(title: string, lines: string[], link?: { url: string; line: string }): string {
  const items = lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  const linkHtml = link
    ? `<p style="margin:16px 0"><a href="${escapeHtml(link.url)}" style="color:#e07b39">${escapeHtml(link.line)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Georgia,serif;background:#16121f;color:#f6ead9;padding:32px">
<h1 style="font-weight:400;color:#f6ead9">${escapeHtml(title)}</h1>
<ul style="line-height:1.7;color:#d9cfe8">${items}</ul>
${linkHtml}
<p style="color:#8a7ea3;font-size:13px">Stillhour — give your last hour a shape.</p>
</body></html>`;
}

export function describeRituals(rituals: readonly { id: string; minutes: number }[]): string[] {
  return rituals.map((r) => `${ritualTitle(r.id)} — ${r.minutes} min`);
}

async function queueEmail(exec: Exec, row: QueuedEmail): Promise<void> {
  await exec.query(
    `INSERT INTO outbox (id, email, kind, subject, body_text, body_html, link_token, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [row.id, row.email, row.kind, row.subject, row.body_text, row.body_html, row.link_token],
  );
}

export async function issueLink(exec: Exec, email: string, purpose: 'confirm' | 'signin'): Promise<string> {
  const token = linkToken();
  await exec.query(
    `INSERT INTO links (token, email, purpose, state, created_at) VALUES ($1,$2,$3,'issued',now())`,
    [token, email, purpose],
  );
  return token;
}

export interface EmailPlan {
  bedtime: string;
  time_zone: string;
  rituals: readonly { id: string; minutes: number }[];
}

export async function queueConfirmationEmail(
  exec: Exec,
  email: string,
  token: string,
  plan: EmailPlan,
  origin: string,
): Promise<string> {
  const lines = [
    'Your Stillhour is planned:',
    `Bedtime: ${plan.bedtime}`,
    `Time zone: ${plan.time_zone}`,
    `Your hour: ${plan.rituals.map((r) => `${ritualTitle(r.id)} (${r.minutes} min)`).join(', ')}`,
  ];
  const url = `${origin}/signin?token=${token}`;
  const text = `${lines.join('\n')}\n\nConfirm your hour: ${url}\nThis link works once, for 15 minutes.`;
  const html = htmlWrap('Confirm your Stillhour', lines, { url, line: 'Confirm your Stillhour' });
  const id = outboxId();
  await queueEmail(exec, { id, email, kind: 'confirm', subject: 'Confirm your Stillhour', body_text: text, body_html: html, link_token: token });
  return id;
}

export async function queueSignInEmail(exec: Exec, email: string, token: string, origin: string): Promise<string> {
  const url = `${origin}/signin?token=${token}`;
  const text = `Open this link to manage your Stillhour: ${url}\nThis link works once, for 15 minutes.`;
  const html = htmlWrap('Your Stillhour sign-in link', [], { url, line: 'Open your Stillhour' });
  const id = outboxId();
  await queueEmail(exec, { id, email, kind: 'signin', subject: 'Your Stillhour sign-in link', body_text: text, body_html: html, link_token: token });
  return id;
}

export async function queueReminderEmail(
  email: string,
  localTime: string,
  plan: EmailPlan,
  origin: string,
): Promise<string> {
  const lines = [
    `Your Stillhour starts at ${localTime} (${plan.time_zone}).`,
    `Bedtime: ${plan.bedtime}`,
    `Your hour: ${plan.rituals.map((r) => `${ritualTitle(r.id)} (${r.minutes} min)`).join(', ')}`,
    `Change or pause reminders: ${origin}/manage`,
  ];
  const text = `${lines.join('\n')}`;
  const html = htmlWrap(`Your Stillhour starts at ${localTime}`, lines.slice(0, 3), { url: `${origin}/manage`, line: 'Manage my hour' });
  const id = outboxId();
  await queueEmail(poolExec, { id, email, kind: 'reminder', subject: `Your Stillhour starts at ${localTime}`, body_text: text, body_html: html, link_token: null });
  return id;
}

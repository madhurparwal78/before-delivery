// Every mail the shop sends (DP-22, DP-33, DP-36, DP-42). Each carries only its published content.

import type { Mailer } from './mailer.js';

export interface MailSender { mailer: Mailer; mailFrom: string }
import { brusselsTimeParts, brusselsDateOf } from '../shared/time.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Tue 30 Mar 2027 */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdayOf(date)} ${d} ${monthNames[m - 1]} ${y}`;
}

/** Tue 30 Mar 2027, 10:20 */
export function formatDateTime(instant: Date): string {
  const { date, hour, minute } = brusselsTimeParts(instant);
  return `${formatDate(date)}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 14:30 */
export function formatTime(instant: Date): string {
  const { hour, minute } = brusselsTimeParts(instant);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** March 2027 */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

export interface HoldMail {
  to: string;
  tagCode: string;
  description: string;
  brand: string;
  size: string;
  price: string;
  endsAt: Date;
  holdPageUrl: string;
}

export async function holdMail(sender: MailSender, m: HoldMail): Promise<void> {
  const { mailer, mailFrom } = sender;
  await mailer.send({
    from: mailFrom,
    to: m.to,
    subject: `Your hold at Atelier Ourlet until ${formatTime(m.endsAt)}`,
    text: [
      `You are holding ${m.tagCode} \u2014 ${m.description} (${m.brand}, size ${m.size}), ${m.price}.`,
      ``,
      `Held until ${formatDateTime(m.endsAt)}.`,
      `Atelier Ourlet, Rue de l\u2019Ourlet 12, 1000 Brussels.`,
      ``,
      `Your hold page: ${m.holdPageUrl}`,
    ].join('\n'),
  });
}

export interface BookingMail {
  to: string;
  startsAt: Date;
  cancelUrl: string;
}

export async function bookingMail(sender: MailSender, m: BookingMail): Promise<void> {
  const { mailer, mailFrom } = sender;
  await mailer.send({
    from: mailFrom,
    to: m.to,
    subject: `Your intake appointment on ${formatDateTime(m.startsAt)}`,
    text: [
      `Your intake appointment is on ${formatDateTime(m.startsAt)}.`,
      `Atelier Ourlet, Rue de l\u2019Ourlet 12, 1000 Brussels.`,
      ``,
      `Need to cancel? ${m.cancelUrl}`,
    ].join('\n'),
  });
}

export interface PortalMail {
  to: string;
  pageUrl: string;
  endsAt: Date;
}

export async function portalMail(sender: MailSender, m: PortalMail): Promise<void> {
  const { mailer, mailFrom } = sender;
  await mailer.send({
    from: mailFrom,
    to: m.to,
    subject: 'Your Atelier Ourlet consignor page',
    text: [
      `Your consignor page is ready: ${m.pageUrl}`,
      `It is open until ${formatDateTime(m.endsAt)}.`,
    ].join('\n'),
  });
}

export interface StatementMail {
  to: string;
  month: string;
  pieces: { tagCode: string; description: string; saleDate: string; share: string }[];
  total: string;
  paidTo?: { lastFour: string };
  heldBackReason?: string;
}

export async function statementMail(sender: MailSender, m: StatementMail): Promise<void> {
  const { mailer, mailFrom } = sender;
  const lines = [
    `Your Atelier Ourlet statement for ${formatMonth(m.month)}.`,
    ``,
    ...m.pieces.map((p) => `${p.tagCode} \u2014 ${p.description}, sold ${p.saleDate}: ${p.share}`),
    ``,
    `Total: ${m.total}`,
  ];
  if (m.paidTo) lines.push(`Paid to the account ending ${m.paidTo.lastFour}`);
  else lines.push(m.heldBackReason ?? '');
  await mailer.send({
    from: mailFrom,
    to: m.to,
    subject: `Your Atelier Ourlet statement for ${formatMonth(m.month)}`,
    text: lines.join('\n'),
  });
}

export function dayOf(instant: Date): string {
  return brusselsDateOf(instant);
}

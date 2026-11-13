// The notice queue. Every notice except the confirmation is written to the
// shared queue in Postgres together with the action that caused it. Every copy
// checks the queue every 10 seconds; each waiting notice is sent exactly once.
import type { Desk } from '../server.js';
import { formatMoney, formatDate, type Language } from '../format.js';
import { slipLines, fill } from '../copy.js';

export type NoticeKind = 'quoted' | 'declined' | 'dispatched' | 'closed' | 'new_link';

export interface NoticePayload {
  reference: string;
  email: string;
  language: Language;
  totalMinor?: number;
  partLineMinor?: number;
  carriageMinor?: number;
  band?: string;
  promiseKind?: 'same_day' | 'later';
  promiseDate?: string;
  refundedMinor?: number;
  paidMinor?: number;
  shareToken?: string;
}

export function noticeSubject(kind: NoticeKind, payload: NoticePayload): string {
  const lang = payload.language;
  const money = (minor?: number) => (minor === undefined ? '' : formatMoney(minor, lang));
  switch (kind) {
    case 'quoted':
      return lang === 'pl-PL'
        ? `Wycena zgłoszenia ${payload.reference}: ${money(payload.totalMinor)}`
        : `Quote for claim ${payload.reference}: ${money(payload.totalMinor)}`;
    case 'declined': {
      if (payload.refundedMinor && payload.refundedMinor > 0) {
        return lang === 'pl-PL'
          ? `Zgłoszenie ${payload.reference} odrzucone — zwrot ${money(payload.refundedMinor)}`
          : `Claim ${payload.reference} declined — ${money(payload.refundedMinor)} refunded`;
      }
      return lang === 'pl-PL'
        ? `Zgłoszenie ${payload.reference} odrzucone — bez opłat`
        : `Claim ${payload.reference} declined — nothing charged`;
    }
    case 'dispatched':
      return lang === 'pl-PL'
        ? `Część w drodze — zgłoszenie ${payload.reference}`
        : `Part on its way for claim ${payload.reference}`;
    case 'closed':
      return lang === 'pl-PL'
        ? `Zgłoszenie ${payload.reference} zostało zamknięte`
        : `Claim ${payload.reference} is closed`;
    case 'new_link':
      return lang === 'pl-PL'
        ? `Nowy link do zgłoszenia ${payload.reference}`
        : `New link for claim ${payload.reference}`;
  }
}

export function noticeBody(kind: NoticeKind, payload: NoticePayload, appUrl: string): string {
  const lang = payload.language;
  const lines = slipLines(lang);
  const share = payload.shareToken ? `${appUrl}/s/${payload.shareToken}` : '';
  switch (kind) {
    case 'quoted': {
      const promise = payload.promiseKind === 'same_day'
        ? fill(lines.sameDayPromise, { date: formatDate(payload.promiseDate ?? '', lang) })
        : fill(lines.laterPromise, { date: formatDate(payload.promiseDate ?? '', lang) });
      return [
        `${fill(lines.partLine, { amount: formatMoney(payload.partLineMinor ?? 0, lang) })}`,
        `${fill(lines.carriageLine, { band: payload.band ?? '', amount: formatMoney(payload.carriageMinor ?? 0, lang) })}`,
        `${fill(lines.total, { amount: formatMoney(payload.totalMinor ?? 0, lang) })}`,
        promise,
        share,
      ].join('\n\n');
    }
    case 'declined':
      return [share].join('\n');
    case 'dispatched':
      return [
        fill(lines.paid, { amount: formatMoney(payload.paidMinor ?? 0, lang) }),
        share,
      ].join('\n\n');
    case 'closed':
      return '';
    case 'new_link':
      return share;
  }
}

/** Queue one notice; the pump sends it exactly once. */
export async function queueNotice(desk: Desk, kind: NoticeKind, payload: NoticePayload): Promise<void> {
  const dedupeKey = `${kind}:${payload.reference}`;
  await desk.store.query(
    `INSERT INTO notice_queue (reference, kind, payload, dedupe_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [payload.reference, kind, JSON.stringify(payload), dedupeKey],
  );
}

export function startNoticePump(desk: Desk): void {
  const tick = async () => {
    try {
      const res = await desk.store.query<{ id: number; reference: string; kind: string; payload: string }>(
        'SELECT id, reference, kind, payload FROM notice_queue ORDER BY id ASC LIMIT 20', [],
      );
      for (const row of res.rows) {
        const payload = JSON.parse(row.payload) as NoticePayload;
        try {
          await desk.mail.send({
            to: payload.email,
            subject: noticeSubject(row.kind as NoticeKind, payload),
            text: noticeBody(row.kind as NoticeKind, payload, desk.config.appPublicUrl),
          });
        } catch {
          return; // Mailpit is down; try again on the next tick.
        }
        await desk.store.query('DELETE FROM notice_queue WHERE id = $1', [row.id]);
      }
    } catch {
      // Postgres unreachable: try again on the next tick.
    }
  };
  const timer = setInterval(() => { void tick(); }, 10_000);
  timer.unref();
  void tick();
}


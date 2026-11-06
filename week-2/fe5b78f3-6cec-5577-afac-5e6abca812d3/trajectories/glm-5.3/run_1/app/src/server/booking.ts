import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { ClassCode, QuotaCode, AcceptCode, Gender, BerthPref } from '../types.js';
import { meetsSeniorCriteria } from '../types.js';
import { runContext, advanceOpening, tatkalOpening } from '../seed.js';
import { parseIstDate, istStamp, nowMs } from '../time.js';
import { farePaise, fareBeforeGstPaise, gstOnFarePaise } from '../fare.js';
import { loadInventory, planAllotment } from './inventory.js';
import { lockRun } from './db.js';
import { ensureAccount, purchase, voidPurchase, KillBillUnreachable } from './killbill.js';
import { putTicket, ticketKey, StorageDown } from './minio.js';
import { queueMail } from './mail.js';
import { buildPdf } from './pdf.js';
import { paiseToRupees } from '../money.js';
import { labelFor } from './labels.js';

// Booking creation: validation, allotment, charge, PNR, e-ticket and mail, all
// together or not at all.

export interface BookingPassengerInput {
  name: string; age: number; gender: Gender; berth_preference: BerthPref;
}

export interface BookingInput {
  train: string; run_date: string; from: string; to: string;
  class: ClassCode; quota: QuotaCode;
  passengers: BookingPassengerInput[];
  keep_in_one_coach: boolean; lower_berth_only: boolean;
  accept: AcceptCode; contact_phone: string;
}

export type BookingFailure =
  | { kind: 'field'; errors: Record<string, string> }
  | { kind: 'not_found' }
  | { kind: 'booking_not_open'; opens_at: string }
  | { kind: 'tatkal_not_open'; opens_at: string }
  | { kind: 'chart_prepared' }
  | { kind: 'quota_full' } | { kind: 'waitlist_full' } | { kind: 'party_split' }
  | { kind: 'no_lower_berth' }
  | { kind: 'availability_changed'; offerAccept: AcceptCode; offerLabel: string }
  | { kind: 'payment_unavailable' } | { kind: 'ticket_storage_unavailable' };

export const FIELD_MESSAGES = {
  name: 'Enter a name',
  age: 'Enter an age from 0 to 125',
  gender: 'Choose a gender',
  berth_preference: 'Choose a berth preference',
  phone: 'Enter +91 and a 10-digit mobile number',
  email: 'Enter a valid email',
  password: 'Use at least 10 characters',
  class: 'Choose SL or 3A',
  quota: 'Choose GN, TQ, LD or SS',
  accept: 'Choose CNF, RAC or WL',
  date: 'Enter a date as YYYY-MM-DD',
  to: 'Choose a different station from From',
  not_calling: 'This train does not call at these stops in this order',
} as const;

export function validatePassengers(input: BookingInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const ps = input.passengers;
  const adults = ps.filter((p) => p.age >= 5);
  const children = ps.filter((p) => p.age < 5);
  if (adults.length < 1) errors['passengers'] = 'Add at least one passenger aged 5 or over';
  if (adults.length > 6) errors['passengers'] = 'Up to 6 passengers aged 5 or over';
  if (children.length > 2) errors['passengers'] = 'Up to 2 children under five';
  if (input.quota === 'TQ' && adults.length > 4) {
    errors['passengers'] = 'Up to 4 passengers aged 5 or over on a Tatkal ticket';
  }
  if (input.quota === 'SS' && adults.length > 2) {
    errors['passengers'] = 'Up to 2 passengers on a Senior quota ticket';
  }
  for (const [i, p] of ps.entries()) {
    if (input.quota === 'LD' && p.age >= 5 && p.gender !== 'F') {
      errors[`passengers[${i}].gender`] = 'Ladies quota is for women travellers';
    }
    if (input.quota === 'SS' && !meetsSeniorCriteria(p.age, p.gender)) {
      errors[`passengers[${i}].age`] = 'Senior quota is for passengers aged 60 or over, or women aged 45 or over';
    }
    if (typeof p.name !== 'string' || p.name.trim().length < 1) {
      errors[`passengers[${i}].name`] = FIELD_MESSAGES.name;
    }
    if (typeof p.age !== 'number' || !Number.isInteger(p.age) || p.age < 0 || p.age > 125) {
      errors[`passengers[${i}].age`] = FIELD_MESSAGES.age;
    }
    if (p.gender !== 'M' && p.gender !== 'F' && p.gender !== 'T') {
      errors[`passengers[${i}].gender`] = FIELD_MESSAGES.gender;
    }
    if (p.berth_preference !== 'NONE' && p.berth_preference !== 'LB' && p.berth_preference !== 'MB'
      && p.berth_preference !== 'UB' && p.berth_preference !== 'SL' && p.berth_preference !== 'SU') {
      errors[`passengers[${i}].berth_preference`] = FIELD_MESSAGES.berth_preference;
    }
  }
  return errors;
}

export function validatePhone(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone ?? '');
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '') && email.length <= 254;
}

export interface CreateBookingDeps { accountId: string; accountEmail: string; accountName: string }

export async function createBooking(
  c: PoolClient, deps: CreateBookingDeps, input: BookingInput,
): Promise<{ ok: true; pnr: string } | { ok: false; failure: BookingFailure }> {
  const now = nowMs();
  const runDateMs = parseIstDate(input.run_date);
  const rc = runContext(input.train, runDateMs ?? 0);
  if (!rc || runDateMs === null) return { ok: false, failure: { kind: 'not_found' } };

  const fromIdx = rc.stops.findIndex((s) => s.code === input.from);
  const toIdx = rc.stops.findIndex((s) => s.code === input.to);
  if (fromIdx === -1 || toIdx === -1) return { ok: false, failure: { kind: 'not_found' } };

  // Window and chart, decided on the business clock, inclusive at the opening instant.
  if (now >= rc.chartMs) return { ok: false, failure: { kind: 'chart_prepared' } };
  if (input.quota === 'TQ') {
    const opens = tatkalOpening(runDateMs, input.class);
    if (now < opens) return { ok: false, failure: { kind: 'tatkal_not_open', opens_at: istStamp(opens) } };
  } else {
    const opens = advanceOpening(runDateMs);
    if (now < opens) return { ok: false, failure: { kind: 'booking_not_open', opens_at: istStamp(opens) } };
  }

  // Validation.
  const errors: Record<string, string> = {};
  if (fromIdx >= toIdx) errors['to'] = FIELD_MESSAGES.to;
  if (input.class !== 'SL' && input.class !== '3A') errors['class'] = FIELD_MESSAGES.class;
  if (!['GN', 'TQ', 'LD', 'SS'].includes(input.quota)) errors['quota'] = FIELD_MESSAGES.quota;
  if (input.accept !== 'CNF' && input.accept !== 'RAC' && input.accept !== 'WL') {
    errors['accept'] = FIELD_MESSAGES.accept;
  }
  if (!validatePhone(input.contact_phone)) errors['contact_phone'] = FIELD_MESSAGES.phone;
  Object.assign(errors, validatePassengers(input));
  if (Object.keys(errors).length > 0) return { ok: false, failure: { kind: 'field', errors } };

  // One booking at a time per run and class, on the holds as they stand.
  await lockRun(c, input.train, input.run_date, input.class);
  const inv = await loadInventory(c, rc, input.class);
  const km = rc.stops[toIdx].km - rc.stops[fromIdx].km;
  const plan = planAllotment(
    inv, rc, input.class, input.quota, fromIdx, toIdx,
    input.passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, pref: p.berth_preference })),
    input.keep_in_one_coach, input.lower_berth_only,
  );
  if (plan.outcome409) return { ok: false, failure: { kind: plan.outcome409 } };

  const rank: Record<string, number> = { CNF: 3, RAC: 2, WL: 1 };
  if (rank[plan.worst] < rank[input.accept]) {
    // The label of the first passenger who gets the worst status.
    const worstKind = plan.worst;
    const counts: Record<string, number> = { GNWL: 0, RLWL: 0, PQWL: 0, TQWL: 0 };
    for (const q of inv.queues) counts[q.wl_type] += 1;
    let racNum = inv.rac.length;
    let label = '';
    for (const r of plan.results) {
      if (r.outcome.kind === 'CNF') continue;
      if (worstKind === 'WL' && r.outcome.kind !== 'WL') continue;
      if (worstKind === 'RAC' && r.outcome.kind !== 'RAC') continue;
      if (r.outcome.kind === 'WL') {
        counts[r.outcome.wlType] = (counts[r.outcome.wlType] ?? 0) + 1;
        label = `${r.outcome.wlType} ${counts[r.outcome.wlType]}`;
      } else if (r.outcome.kind === 'RAC') {
        racNum += 1;
        label = `RAC ${racNum} ${r.outcome.coach} ${r.outcome.berth} SL`;
      }
      break;
    }
    return { ok: false, failure: { kind: 'availability_changed', offerAccept: plan.worst, offerLabel: label || 'WL' } };
  }

  // Fare.
  const tatkal = input.quota === 'TQ';
  const fares = input.passengers.map((p) =>
    p.age >= 5 ? farePaise(km, input.class, tatkal) : 0);
  const fareLines: { label: string; amount_paise: number }[] = [];
  let gstTotal = 0;
  input.passengers.forEach((p, i) => {
    if (p.age >= 5) {
      const before = fareBeforeGstPaise(km, input.class, tatkal);
      gstTotal += gstOnFarePaise(before, input.class);
      fareLines.push({ label: `Passenger ${i + 1} fare`, amount_paise: before });
    } else {
      fareLines.push({ label: `Passenger ${i + 1} — under five, no berth`, amount_paise: 0 });
    }
  });
  if (input.class === '3A') fareLines.push({ label: 'GST 5%', amount_paise: gstTotal });
  const total = fares.reduce((a, b) => a + b, 0);

  // PNR: 10 digits, first not 0, random, unique.
  let pnr = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10));
    digits[0] = 1 + Math.floor(Math.random() * 9);
    const candidate = digits.join('');
    const exists = await c.query('SELECT 1 FROM bookings WHERE pnr = $1', [candidate]);
    if (exists.rowCount === 0) { pnr = candidate; break; }
  }
  if (!pnr) return { ok: false, failure: { kind: 'payment_unavailable' } };

  // Charge before the PNR exists.
  let kbAccount: string;
  try {
    kbAccount = await ensureAccount(deps.accountId, deps.accountName);
    const purchaseResult = await purchase(kbAccount, pnr, paiseToRupees(total));
    if (!purchaseResult.ok) return { ok: false, failure: { kind: 'payment_unavailable' } };
  } catch (e) {
    if (e instanceof KillBillUnreachable) return { ok: false, failure: { kind: 'payment_unavailable' } };
    throw e;
  }

  // Persist booking, passengers and holds.
  await c.query(
    `INSERT INTO bookings (pnr, version, account_id, train, run_date, from_code, to_code, from_idx, to_idx,
       cls, quota, keep_in_one_coach, lower_berth_only, contact_phone, total_paise, fare_lines, state, created_at)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'booked', now())`,
    [pnr, deps.accountId, input.train, input.run_date, input.from, input.to, fromIdx, toIdx,
      input.class, input.quota, input.keep_in_one_coach, input.lower_berth_only,
      input.contact_phone, total, JSON.stringify(fareLines)],
  );

  const counts: Record<string, number> = { GNWL: 0, RLWL: 0, PQWL: 0, TQWL: 0 };
  for (const q of inv.queues) counts[q.wl_type] += 1;
  let racNum = inv.rac.length;
  let seqN = 0;

  for (const [i, r] of plan.results.entries()) {
    const p = input.passengers[i];
    let status: string; let wlType: string | null = null; let wlNum: number | null = null;
    let racPlace: number | null = null; let coach: string | null = null;
    let berth: number | null = null; let berthType: string | null = null;
    if (r.outcome.kind === 'CNF') {
      status = 'CNF'; coach = r.outcome.coach; berth = r.outcome.berth; berthType = r.outcome.berthType;
      await c.query(
        `INSERT INTO holds (train, run_date, coach, berth, place, pnr, passenger, from_idx, to_idx)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8)`,
        [input.train, input.run_date, r.outcome.coach, r.outcome.berth, pnr, i + 1, fromIdx, toIdx],
      );
    } else if (r.outcome.kind === 'RAC') {
      status = 'RAC'; coach = r.outcome.coach; berth = r.outcome.berth; berthType = 'SL';
      racNum += 1; racPlace = racNum;
      await c.query(
        `INSERT INTO holds (train, run_date, coach, berth, place, pnr, passenger, from_idx, to_idx)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.train, input.run_date, r.outcome.coach, r.outcome.berth, r.outcome.place, pnr, i + 1, fromIdx, toIdx],
      );
    } else {
      status = r.outcome.wlType; wlType = r.outcome.wlType;
      counts[wlType] += 1; wlNum = counts[wlType];
    }
    seqN = Number((await c.query<{ nextval: string }>('SELECT nextval(\'passenger_seq\') AS nextval')).rows[0].nextval);
    await c.query(
      `INSERT INTO passengers (pnr, number, name, age, gender, berth_preference, fare_paise, status,
         wl_type, wl_num, rac_place, coach, berth, berth_type, from_idx, to_idx, seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [pnr, i + 1, p.name, p.age, p.gender, p.berth_preference, fares[i], status,
        wlType, wlNum, racPlace, coach, berth, berthType, fromIdx, toIdx, seqN],
    );
  }

  // Reserve e-ticket v1 and queue the e-ticket mail in the same change.
  await c.query(`INSERT INTO tickets (pnr, version, kind, created_at) VALUES ($1, 1, 'booked', now())`, [pnr]);

  const rows = await c.query(
    `SELECT number, name, age, status, wl_type, wl_num, rac_place, coach, berth, berth_type
     FROM passengers WHERE pnr = $1 ORDER BY number`, [pnr],
  );
  const labels = rows.rows.map((row) => ({
    number: row.number as number, name: row.name as string, age: row.age as number,
    label: labelFor(row),
  }));
  const pdf = buildPdf([
    { text: 'Pakka Rail e-ticket', bold: true, size: 16 },
    { text: `PNR: ${pnr}`, bold: true, size: 13 },
    { text: `Train: ${rc.train.number} ${rc.train.name}` },
    { text: `Run date: ${input.run_date}` },
    { text: `From: ${input.from} ${rc.stops[fromIdx].name}` },
    { text: `To: ${input.to} ${rc.stops[toIdx].name}` },
    { text: `Class: ${input.class}  Quota: ${input.quota}` },
    { text: `Total fare: ${paiseToRupees(total)}` },
    { text: 'Passengers:' },
    ...labels.map((l) => ({ text: `Passenger ${l.number}: ${l.name}, ${l.age} — ${l.label}` })),
  ]);

  try {
    const etag = await putTicket(ticketKey(pnr, 1, 'booked'), pdf);
    await c.query('UPDATE tickets SET stored = true, etag = $1 WHERE pnr = $2 AND version = 1', [etag, pnr]);
  } catch (e) {
    if (e instanceof StorageDown) {
      // All-or-nothing: give back the captured fare and book nobody.
      await voidPurchase(kbAccount, pnr, paiseToRupees(total)).catch(() => undefined);
      return { ok: false, failure: { kind: 'ticket_storage_unavailable' } };
    }
    throw e;
  }

  await queueMail(c, deps.accountEmail, `E-ticket for PNR ${pnr}`,
    `Your booking is recorded with PNR ${pnr}.\n` +
    labels.map((l) => `Passenger ${l.number}: ${l.label}`).join('\n') + '\n');

  return { ok: true, pnr };
}

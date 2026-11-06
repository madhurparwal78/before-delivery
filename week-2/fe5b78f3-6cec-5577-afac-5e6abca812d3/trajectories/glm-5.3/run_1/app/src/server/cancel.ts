import type { PoolClient } from 'pg';
import { runContext } from '../seed.js';
import { nowMs, istStamp, istDate } from '../time.js';
import { loadInventory, stretchesOverlap } from './inventory.js';
import { lockRun } from './db.js';
import { applyBand, isPartConfirmedParty, partyClerkage } from './bands.js';
import { labelFor } from './labels.js';
import { BERTHS_PER_COACH, berthQuota, berthType } from '../berth.js';
import { ClassCode, BandCode, PassengerState, QuotaCode } from '../types.js';

// Cancellation: the quote, the bands, the refund in paise, the promotion order
// and the contiguous renumbering, all inside one change.

export interface QuoteEntry {
  number: number; band: BandCode; charge_paise: number; gst_paise: number;
  deduction_paise: number; refund_paise: number;
}

export type CancelFailure =
  | { kind: 'not_found' }
  | { kind: 'field'; errors: Record<string, string> }
  | { kind: 'already_cancelled' }
  | { kind: 'journey_complete' };

interface PassengerRow {
  pnr: string; number: number; name: string; age: number; gender: string;
  berth_preference: string; fare_paise: string; status: string; wl_type: string | null;
  wl_num: number | null; rac_place: number | null; coach: string | null;
  berth: number | null; berth_type: string | null; from_idx: number; to_idx: number; seq: string;
}

export interface BookingRow {
  pnr: string; version: number; account_id: string; train: string; run_date: string;
  from_code: string; to_code: string; from_idx: number; to_idx: number;
  cls: ClassCode; quota: string; keep_in_one_coach: boolean; lower_berth_only: boolean;
  contact_phone: string; total_paise: string; fare_lines: { label: string; amount_paise: number }[];
  state: string; created_at: Date;
}

export async function loadBooking(c: PoolClient, pnr: string): Promise<BookingRow | null> {
  const r = await c.query('SELECT *, to_char(run_date, \'YYYY-MM-DD\') AS run_date FROM bookings WHERE pnr = $1', [pnr]);
  return (r.rows[0] as BookingRow) ?? null;
}

export async function loadPassengers(c: PoolClient, pnr: string): Promise<PassengerRow[]> {
  const r = await c.query<PassengerRow>('SELECT * FROM passengers WHERE pnr = $1 ORDER BY number', [pnr]);
  return r.rows;
}

export function runContextOf(b: BookingRow) {
  return runContext(b.train, Date.parse(b.run_date + 'T00:00:00+05:30'));
}

function bandFor(
  p: PassengerRow, b: BookingRow, chartPrepared: boolean, minutes: number,
): ReturnType<typeof applyBand> {
  return applyBand({
    state: p.status as PassengerState, age: p.age, cls: b.cls, quota: b.quota as QuotaCode,
    farePaise: Number(p.fare_paise), chartPrepared, minutesToDeparture: minutes,
  });
}

export async function cancellationQuote(
  c: PoolClient, pnr: string, numbers: number[],
): Promise<{ ok: true; quoted_at: string; passengers: QuoteEntry[]; refund_paise: number } | { ok: false; failure: CancelFailure }> {
  const b = await loadBooking(c, pnr);
  if (!b) return { ok: false, failure: { kind: 'not_found' } };
  const rc = runContextOf(b);
  if (!rc) return { ok: false, failure: { kind: 'not_found' } };
  const now = nowMs();
  const rows = await loadPassengers(c, pnr);
  const chartPrepared = now >= rc.chartMs;
  const minutes = Math.floor((rc.stops[b.from_idx].depMs - now) / 60_000);

  const errors: Record<string, string> = {};
  if (numbers.length < 1) errors['passengers'] = 'Choose at least one passenger';
  for (const n of numbers) {
    if (!rows.some((p) => p.number === n)) errors['passengers'] = `Passenger ${n} is not on this PNR`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, failure: { kind: 'field', errors } };

  const entries: QuoteEntry[] = numbers.map((n) => {
    const p = rows.find((x) => x.number === n)!;
    const out = bandFor(p, b, chartPrepared, minutes);
    return {
      number: n, band: out.band, charge_paise: out.chargePaise, gst_paise: out.gstPaise,
      deduction_paise: out.deductionPaise, refund_paise: out.refundPaise,
    };
  });
  return {
    ok: true, quoted_at: istStamp(now), passengers: entries,
    refund_paise: entries.reduce((a, e) => a + e.refund_paise, 0),
  };
}

interface PromotedChange { number: number; from: string; to: string; moved: boolean }

export interface CancelSuccess {
  pnr: string;
  cancellationNumber: number;
  passengers: QuoteEntry[];
  refundTotal: number;
  refundRow: { number: number; reason: string; refund_paise: number; status: string } | null;
  ticketVersion: number;
}

export async function cancelPassengers(
  c: PoolClient, pnr: string, numbers: number[], ownerEmail: string,
): Promise<{ ok: true; result: CancelSuccess } | { ok: false; failure: CancelFailure }> {
  const b = await loadBooking(c, pnr);
  if (!b) return { ok: false, failure: { kind: 'not_found' } };
  const rc = runContextOf(b);
  if (!rc) return { ok: false, failure: { kind: 'not_found' } };
  const now = nowMs();
  const chartPrepared = now >= rc.chartMs;

  if (now > rc.stops[b.to_idx].depMs) {
    return { ok: false, failure: { kind: 'journey_complete' } };
  }

  const rows = await loadPassengers(c, pnr);

  const errors: Record<string, string> = {};
  if (numbers.length < 1) errors['passengers'] = 'Choose at least one passenger';
  for (const n of numbers) {
    if (!rows.some((p) => p.number === n)) errors['passengers'] = `Passenger ${n} is not on this PNR`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, failure: { kind: 'field', errors } };

  for (const n of numbers) {
    const p = rows.find((x) => x.number === n)!;
    if (p.status === 'CAN' || p.status === 'CHART_NOT_CONFIRMED') {
      return { ok: false, failure: { kind: 'already_cancelled' } };
    }
  }

  // One change at a time per run and class.
  await lockRun(c, b.train, b.run_date, b.cls);

  // The band is decided afresh at the instant the request arrives.
  const minutes = Math.floor((rc.stops[b.from_idx].depMs - now) / 60_000);
  const selected = numbers.map((n) => rows.find((x) => x.number === n)!);
  const unselectedAdults = rows.filter(
    (p) => !numbers.includes(p.number) && p.age >= 5 && p.status !== 'CAN' && p.status !== 'CHART_NOT_CONFIRMED',
  ).length;
  const party = isPartConfirmedParty(
    b.quota as QuotaCode, chartPrepared, selected.map((p) => p.status as PassengerState), unselectedAdults,
  );

  const entries: QuoteEntry[] = selected.map((p) => {
    const out = party
      ? partyClerkage(Number(p.fare_paise), b.cls)
      : bandFor(p, b, chartPrepared, minutes);
    return {
      number: p.number, band: out.band, charge_paise: out.chargePaise, gst_paise: out.gstPaise,
      deduction_paise: out.deductionPaise, refund_paise: out.refundPaise,
    };
  });
  const refundTotal = entries.reduce((a, e) => a + e.refund_paise, 0);

  // Record the cancellation, then free the held berths and places.
  const cnum = Number((
    await c.query<{ n: string }>('SELECT COALESCE(MAX(number),0)+1 AS n FROM cancellations WHERE pnr = $1', [pnr])
  ).rows[0].n);
  await c.query(
    `INSERT INTO cancellations (pnr, number, requested_at, refund_paise, reason) VALUES ($1,$2,$3,$4,'cancellation')`,
    [pnr, cnum, new Date(now), refundTotal],
  );
  for (const e of entries) {
    await c.query(
      `INSERT INTO cancellation_passengers (pnr, cancellation, number, band, charge_paise, gst_paise, deduction_paise, refund_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [pnr, cnum, e.number, e.band, e.charge_paise, e.gst_paise, e.deduction_paise, e.refund_paise],
    );
  }

  const cancelNumbers = [...numbers];
  if (rows.filter((p) => p.age >= 5 && p.status !== 'CAN' && p.status !== 'CHART_NOT_CONFIRMED' && !numbers.includes(p.number)).length === 0) {
    for (const p of rows) {
      if (p.age < 5 && p.status !== 'CAN' && !cancelNumbers.includes(p.number)) cancelNumbers.push(p.number);
    }
  }

  for (const n of cancelNumbers) {
    const p = rows.find((x) => x.number === n)!;
    await c.query(
      `INSERT INTO passenger_history (pnr, passenger, at, from_label, to_label) VALUES ($1,$2,$3,$4,'CAN')`,
      [pnr, n, new Date(now), labelFor(p)],
    );
    await c.query(`DELETE FROM holds WHERE pnr = $1 AND passenger = $2`, [pnr, n]);
    await c.query(
      `UPDATE passengers SET status = 'CAN', wl_type = NULL, wl_num = NULL, rac_place = NULL,
         coach = NULL, berth = NULL, berth_type = NULL WHERE pnr = $1 AND number = $2`,
      [pnr, n],
    );
  }

  // Promotion runs inside the same change, and only before the chart instant.
  const byPnr = chartPrepared ? new Map<string, PromotedChange[]>() : await promote(c, rc, b.cls, now);

  // Booking versions: this PNR rises by one for the cancellation, plus one per
  // promotion or renumbering event; other PNRs rise by one per event.
  for (const [pnrAffected] of byPnr) {
    if (pnrAffected !== pnr) {
      await c.query('UPDATE bookings SET version = version + 1 WHERE pnr = $1', [pnrAffected]);
    }
  }
  await c.query(
    'UPDATE bookings SET version = version + 1 + $1 WHERE pnr = $2',
    [byPnr.has(pnr) ? 1 : 0, pnr],
  );

  // Refund row, pending until Kill Bill records it.
  let refundRow: CancelSuccess['refundRow'] = null;
  if (refundTotal > 0) {
    const rnum = Number((
      await c.query<{ n: string }>('SELECT COALESCE(MAX(number),0)+1 AS n FROM refunds WHERE pnr = $1', [pnr])
    ).rows[0].n);
    await c.query(
      `INSERT INTO refunds (pnr, number, reason, refund_paise, status) VALUES ($1,$2,'cancellation',$3,'pending')`,
      [pnr, rnum, refundTotal],
    );
    refundRow = { number: rnum, reason: 'cancellation', refund_paise: refundTotal, status: 'pending' };
  }

  // A new e-ticket version after every cancellation that answers 201.
  const tver = Number((
    await c.query<{ n: string }>('SELECT COALESCE(MAX(version),0)+1 AS n FROM tickets WHERE pnr = $1', [pnr])
  ).rows[0].n);
  await c.query(`INSERT INTO tickets (pnr, version, kind, created_at) VALUES ($1,$2,'cancellation',now())`, [pnr, tver]);

  // One status-moved mail per affected PNR, only when a passenger moved up.
  for (const [pnrAffected, changes] of byPnr) {
    const movedLines = changes.filter((x) => x.moved);
    if (movedLines.length === 0) continue;
    const email = pnrAffected === pnr ? ownerEmail : (
      await c.query<{ email: string }>(
        'SELECT a.email FROM accounts a JOIN bookings bb ON bb.account_id = a.id WHERE bb.pnr = $1', [pnrAffected],
      )
    ).rows[0]?.email;
    if (!email) continue;
    const lines = movedLines.map((x) => `Passenger ${x.number}: ${x.from} to ${x.to}`).join('\n');
    await c.query('INSERT INTO mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)',
      [email, `Your status moved: PNR ${pnrAffected}`, `${lines}\n`]);
  }

  return {
    ok: true,
    result: {
      pnr, cancellationNumber: cnum, passengers: entries, refundTotal, refundRow, ticketVersion: tver,
    },
  };
}

interface QRow {
  pnr: string; number: number; status: string; wl_type: string | null; wl_num: number | null;
  rac_place: number | null; coach: string | null; berth: number | null; berth_type: string | null;
  from_idx: number; to_idx: number; seq: string;
}

/**
 * The promotion order, decided in exactly one place. A freed General berth
 * goes to the first fitting RAC passenger (lowest RAC number), and only then
 * to the first fitting passenger on GNWL, RLWL, PQWL; a freed RAC place goes
 * to the first fitting waiting passenger; a freed Tatkal berth goes to the
 * first fitting TQWL passenger. The cascade completes inside one change, and
 * queues are renumbered from 1 upward without gaps.
 */
export async function promote(
  c: PoolClient, rc: NonNullable<ReturnType<typeof runContext>>, cls: ClassCode, now: number,
): Promise<Map<string, PromotedChange[]>> {
  const runDate = istDate(rc.runDateMs);
  const inv = await loadInventory(c, rc, cls);
  const rows = (
    await c.query<QRow>(
      `SELECT p.pnr, p.number, p.status, p.wl_type, p.wl_num, p.rac_place, p.coach, p.berth,
              p.berth_type, p.from_idx, p.to_idx, p.seq::text AS seq
       FROM passengers p JOIN bookings b ON b.pnr = p.pnr
       WHERE b.train = $1 AND b.run_date = $2 AND b.cls = $3
         AND p.status IN ('RAC','GNWL','RLWL','PQWL','TQWL')
       ORDER BY p.seq`,
      [rc.train.number, runDate, cls],
    )
  ).rows;

  const holdList = inv.holds.map((h) => ({ ...h }));
  const berthFree = (coach: string, berth: number, from: number, to: number) =>
    !holdList.some((h) => h.coach === coach && h.berth === berth && h.place === 0
      && stretchesOverlap(h.from_idx, h.to_idx, from, to));
  const placeFree = (coach: string, berth: number, place: number, from: number, to: number) =>
    !holdList.some((h) => h.coach === coach && h.berth === berth && h.place === place
      && stretchesOverlap(h.from_idx, h.to_idx, from, to));

  const fromLabels = new Map<string, string>();
  for (const r of rows) fromLabels.set(`${r.pnr}:${r.number}`, labelFor(r));

  const addHold = (coach: string, berth: number, place: number, pnr: string, number: number, from: number, to: number) => {
    holdList.push({ coach, berth, place, pnr, passenger: number, from_idx: from, to_idx: to });
  };
  const removeHold = (pnr: string, number: number) => {
    const i = holdList.findIndex((h) => h.pnr === pnr && h.passenger === number);
    if (i !== -1) holdList.splice(i, 1);
  };

  const firstFreeBerth = (quota: 'GN' | 'TQ', from: number, to: number) => {
    for (const coach of inv.coaches) {
      for (let b = 1; b <= BERTHS_PER_COACH; b++) {
        if (berthQuota(b) !== quota) continue;
        if (berthFree(coach, b, from, to)) return { coach, berth: b };
      }
    }
    return null;
  };
  const firstFreePlace = (from: number, to: number) => {
    for (const coach of inv.coaches) {
      for (let b = 1; b <= BERTHS_PER_COACH; b++) {
        if (berthQuota(b) !== 'RAC') continue;
        for (const place of [1, 2]) {
          if (placeFree(coach, b, place, from, to)) return { coach, berth: b, place };
        }
      }
    }
    return null;
  };

  let progressed = true;
  while (progressed) {
    progressed = false;
    // RAC first: an RAC passenger is always promoted to CNF before any waiting-list passenger moves up.
    for (const r of [...rows].sort((a, x) => (a.rac_place ?? 0) - (x.rac_place ?? 0))) {
      if (r.status !== 'RAC') continue;
      const spot = firstFreeBerth('GN', r.from_idx, r.to_idx);
      if (!spot) continue;
      removeHold(r.pnr, r.number);
      r.status = 'CNF'; r.coach = spot.coach; r.berth = spot.berth; r.berth_type = berthType(spot.berth);
      r.rac_place = null; r.wl_type = null; r.wl_num = null;
      addHold(spot.coach, spot.berth, 0, r.pnr, r.number, r.from_idx, r.to_idx);
      progressed = true;
    }
    if (progressed) continue;
    // Then waiting lists: a berth if one fits, else an RAC place.
    for (const wl of ['GNWL', 'RLWL', 'PQWL', 'TQWL']) {
      for (const r of rows) {
        if (r.status !== wl) continue;
        const pool = wl === 'TQWL' ? 'TQ' : 'GN';
        const spot = firstFreeBerth(pool as 'GN' | 'TQ', r.from_idx, r.to_idx);
        if (spot) {
          r.status = 'CNF'; r.coach = spot.coach; r.berth = spot.berth; r.berth_type = berthType(spot.berth);
          r.wl_type = null; r.wl_num = null; r.rac_place = null;
          addHold(spot.coach, spot.berth, 0, r.pnr, r.number, r.from_idx, r.to_idx);
          progressed = true;
          continue;
        }
        if (wl !== 'TQWL') {
          const place = firstFreePlace(r.from_idx, r.to_idx);
          if (place) {
            r.status = 'RAC'; r.coach = place.coach; r.berth = place.berth; r.berth_type = 'SL';
            r.wl_type = null; r.wl_num = null;
            addHold(place.coach, place.berth, place.place, r.pnr, r.number, r.from_idx, r.to_idx);
            progressed = true;
          }
        }
      }
      if (progressed) break;
    }
  }

  // Contiguous renumbering, keeping order.
  let racCounter = 0;
  for (const r of rows.filter((x) => x.status === 'RAC').sort((a, x) => Number(a.seq) - Number(x.seq))) {
    racCounter += 1;
    r.rac_place = racCounter;
  }
  const wlCount: Record<string, number> = {};
  for (const r of rows.filter((x) => x.status !== 'RAC' && x.status !== 'CNF')
    .sort((a, x) => Number(a.seq) - Number(x.seq))) {
    const t = r.wl_type ?? r.status;
    wlCount[t] = (wlCount[t] ?? 0) + 1;
    r.wl_num = wlCount[t];
  }

  // Persist the changes: holds, passengers, history and versions.
  const changes = new Map<string, PromotedChange[]>();
  const at = new Date(now);
  for (const r of rows) {
    const before = fromLabels.get(`${r.pnr}:${r.number}`)!;
    const after = labelFor(r);
    if (before === after) continue;
    await c.query(
      `UPDATE passengers SET status = $3, wl_type = $4, wl_num = $5, rac_place = $6,
         coach = $7, berth = $8, berth_type = $9 WHERE pnr = $1 AND number = $2`,
      [r.pnr, r.number, r.status, r.wl_type, r.wl_num, r.rac_place, r.coach, r.berth, r.berth_type],
    );
    await c.query(`DELETE FROM holds WHERE pnr = $1 AND passenger = $2`, [r.pnr, r.number]);
    if (r.status === 'CNF' || r.status === 'RAC') {
      const placeNum = holdList.find((h) => h.pnr === r.pnr && h.passenger === r.number)?.place ?? 0;
      await c.query(
        `INSERT INTO holds (train, run_date, coach, berth, place, pnr, passenger, from_idx, to_idx)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rc.train.number, runDate, r.coach, r.berth, placeNum, r.pnr, r.number, r.from_idx, r.to_idx],
      );
    }
    await c.query(
      `INSERT INTO passenger_history (pnr, passenger, at, from_label, to_label) VALUES ($1,$2,$3,$4,$5)`,
      [r.pnr, r.number, at, before, after],
    );
    const fromStatus = before.split(' ')[0];
    const moved = (r.status === 'CNF' || r.status === 'RAC') && fromStatus !== 'CAN';
    const arr = changes.get(r.pnr) ?? [];
    arr.push({ number: r.number, from: before, to: after, moved });
    changes.set(r.pnr, arr);
  }
  return changes;
}

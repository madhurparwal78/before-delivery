// The booking body as the API reports it at a business instant, including the chart instant before the job has run.
import type { Booking, BookingState, Cancellation, CancelledPassenger, PassengerStatus, Refund, TicketKind } from "../../shared/api.js";
import { istTimestamp } from "../domain/clock.js";
import { type Catalog, type Train, findTrain, stretchOf } from "../domain/catalog.js";
import { chartAt, departureAt, isChartPrepared, isJourneyComplete } from "../domain/schedule.js";
import { type StatusFields, atChart, describe } from "../domain/status.js";
import { reportedVersion } from "../domain/version.js";
import { type BookingRow, type Db, type PassengerRow, passengerRows } from "./rows.js";

interface Timeline {
  train: Train;
  chartAt: number;
  departureAt: number;
  arrivalAt: number;
  chartDue: boolean;
  complete: boolean;
}

export function timelineOf(catalog: Catalog, row: BookingRow, now: number): Timeline {
  const train = findTrain(catalog, row.train);
  const stretch = train && stretchOf(train, row.from_code, row.to_code);
  if (!train || !stretch) throw new Error(`booking ${row.pnr} names an unknown stretch`);
  const chart = chartAt(train, row.run_date);
  const arrival = departureAt(row.run_date, stretch.to);
  return {
    train,
    chartAt: chart,
    departureAt: departureAt(row.run_date, stretch.from),
    arrivalAt: arrival,
    chartDue: isChartPrepared(now, chart),
    complete: isJourneyComplete(now, arrival),
  };
}

export function stateOf(t: Timeline): BookingState {
  if (t.complete) return "journey_complete";
  return t.chartDue ? "chart_prepared" : "booked";
}

export function fieldsOf(p: PassengerRow): StatusFields {
  return { status: p.status, position: p.position, coach: p.coach, berth: p.berth };
}

/** The status a passenger reports now: every waiting-list place is NOT CNF from the chart instant itself. */
export function currentStatus(p: PassengerRow, t: Timeline): PassengerStatus {
  const fields = fieldsOf(p);
  return describe(t.chartDue ? atChart(fields) : fields);
}

export async function bookingBody(db: Db, catalog: Catalog, row: BookingRow, now: number): Promise<Booking> {
  const t = timelineOf(catalog, row, now);
  const passengers = await passengerRows(db, row.pnr);
  const history = await db.query<{ number: number; at_ms: number; from_label: string; to_label: string }>(
    "SELECT number, at_ms, from_label, to_label FROM history WHERE pnr = $1 ORDER BY id",
    [row.pnr],
  );
  const tickets = await db.query<{ version: number; kind: TicketKind; created_ms: number }>(
    "SELECT version, kind, created_ms FROM tickets WHERE pnr = $1 AND stored ORDER BY version",
    [row.pnr],
  );
  const cancellations = await db.query<{ number: number; requested_ms: number; passengers: CancelledPassenger[]; refund_paise: number }>(
    "SELECT number, requested_ms, passengers, refund_paise FROM cancellations WHERE pnr = $1 ORDER BY number",
    [row.pnr],
  );
  const refunds = await db.query<{ number: number; reason: Refund["reason"]; refund_paise: number; status: Refund["status"]; issued_ms: number | null }>(
    "SELECT number, reason, refund_paise, status, issued_ms FROM refunds WHERE pnr = $1 ORDER BY number",
    [row.pnr],
  );
  return {
    pnr: row.pnr,
    version: reportedVersion(row.version, t.chartDue, row.chart_recorded),
    state: stateOf(t),
    train: { number: t.train.number, name: t.train.name },
    run_date: row.run_date,
    from: row.from_code,
    to: row.to_code,
    class: row.class,
    quota: row.quota,
    departure_at: istTimestamp(t.departureAt),
    arrival_at: istTimestamp(t.arrivalAt),
    chart_at: istTimestamp(t.chartAt),
    chart_prepared: t.chartDue,
    keep_in_one_coach: row.keep_in_one_coach,
    lower_berth_only: row.lower_berth_only,
    contact_phone: row.contact_phone,
    total_paise: row.total_paise,
    fare_lines: row.fare_lines,
    passengers: passengers.map((p) => ({
      number: p.number,
      name: p.name,
      age: p.age,
      gender: p.gender,
      berth_preference: p.berth_preference,
      fare_paise: p.fare_paise,
      booking_status: p.booking_status,
      current_status: currentStatus(p, t),
      history: history.rows
        .filter((h) => h.number === p.number)
        .map((h) => ({ at: istTimestamp(h.at_ms), from_label: h.from_label, to_label: h.to_label })),
    })),
    tickets: tickets.rows.map((x) => ({ version: x.version, kind: x.kind, created_at: istTimestamp(x.created_ms) })),
    cancellations: cancellations.rows.map(cancellationOf),
    refunds: refunds.rows.map((r) => ({
      number: r.number,
      reason: r.reason,
      refund_paise: r.refund_paise,
      status: r.status,
      issued_at: r.issued_ms === null ? null : istTimestamp(r.issued_ms),
    })),
  };
}

export function cancellationOf(c: { number: number; requested_ms: number; passengers: CancelledPassenger[]; refund_paise: number }): Cancellation {
  return { number: c.number, requested_at: istTimestamp(c.requested_ms), passengers: c.passengers, refund_paise: c.refund_paise };
}

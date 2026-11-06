import type {
  BookingRecord,
  CancellationRecord,
  HistoryRecord,
  PassengerRecord,
  RefundRecord,
  TicketRecord,
} from '../data/bookings';
import { istTimestamp } from '../domain/ist';
import type { TrainRow } from '../domain/schedule';
import { chartAt, runStops, stopBySeq } from '../domain/schedule';
import type { PassengerStatus } from '../domain/status';
import { CHART_NOT_CONFIRMED, isWaitingList } from '../domain/status';

export type PnrState = 'booked' | 'chart_prepared' | 'journey_complete';

export interface RunFacts {
  readonly chartInstant: number;
  readonly departureAt: number;
  readonly arrivalAt: number;
  readonly chartPrepared: boolean;
  readonly journeyComplete: boolean;
  readonly state: PnrState;
}

export function runFacts(booking: BookingRecord, train: TrainRow, now: number): RunFacts {
  const stops = runStops(train, booking.run_date);
  const departure = stopBySeq(stops, booking.from_seq);
  const arrival = stopBySeq(stops, booking.to_seq);
  const chartInstant = chartAt(train, booking.run_date);
  const chartPrepared = now >= chartInstant;
  const journeyComplete = now >= arrival.at;
  return {
    chartInstant,
    departureAt: departure.at,
    arrivalAt: arrival.at,
    chartPrepared,
    journeyComplete,
    state: journeyComplete ? 'journey_complete' : chartPrepared ? 'chart_prepared' : 'booked',
  };
}

/**
 * From the chart instant a run counts as chart-prepared for every answer, whether or not the chart
 * job has run yet, so a waitlisted passenger already reads as not confirmed.
 */
export function effectiveStatus(status: PassengerStatus, chartPrepared: boolean): PassengerStatus {
  return chartPrepared && isWaitingList(status.status) ? CHART_NOT_CONFIRMED : status;
}

/** The reported version already counts the chart from the chart instant. */
export function effectiveVersion(booking: BookingRecord, facts: RunFacts): number {
  return booking.version + (facts.chartPrepared && !booking.chart_applied ? 1 : 0);
}

export interface BookingBundle {
  readonly booking: BookingRecord;
  readonly passengers: readonly PassengerRecord[];
  readonly history: readonly HistoryRecord[];
  readonly cancellations: readonly CancellationRecord[];
  readonly refunds: readonly RefundRecord[];
  readonly tickets: readonly TicketRecord[];
  readonly train: TrainRow;
}

export function bookingBody(bundle: BookingBundle, now: number): Record<string, unknown> {
  const { booking, train } = bundle;
  const facts = runFacts(booking, train, now);
  return {
    pnr: booking.pnr,
    version: effectiveVersion(booking, facts),
    state: facts.state,
    train: { number: train.number, name: train.name },
    run_date: booking.run_date,
    from: booking.from_code,
    to: booking.to_code,
    class: booking.travel_class,
    quota: booking.quota,
    departure_at: istTimestamp(facts.departureAt),
    arrival_at: istTimestamp(facts.arrivalAt),
    chart_at: istTimestamp(facts.chartInstant),
    chart_prepared: facts.chartPrepared,
    keep_in_one_coach: booking.keep_in_one_coach,
    lower_berth_only: booking.lower_berth_only,
    contact_phone: booking.contact_phone,
    total_paise: booking.total_paise,
    fare_lines: booking.fare_lines,
    passengers: bundle.passengers.map((passenger) => ({
      number: passenger.number,
      name: passenger.name,
      age: passenger.age,
      gender: passenger.gender,
      berth_preference: passenger.berth_preference,
      fare_paise: passenger.fare_paise,
      booking_status: passenger.booking_status,
      current_status: effectiveStatus(passenger.current_status, facts.chartPrepared),
      history: bundle.history
        .filter((entry) => entry.passenger_number === passenger.number)
        .map((entry) => ({
          at: istTimestamp(entry.at.getTime()),
          from_label: entry.from_label,
          to_label: entry.to_label,
        })),
    })),
    tickets: bundle.tickets
      .filter((ticket) => ticket.stored)
      .map((ticket) => ({
        version: ticket.version,
        kind: ticket.kind,
        created_at: istTimestamp(ticket.created_at.getTime()),
      })),
    cancellations: bundle.cancellations.map((cancellation) => ({
      number: cancellation.number,
      requested_at: istTimestamp(cancellation.requested_at.getTime()),
      passengers: cancellation.passengers,
      refund_paise: cancellation.refund_paise,
    })),
    refunds: bundle.refunds.map((refund) => ({
      number: refund.number,
      reason: refund.reason,
      refund_paise: refund.refund_paise,
      status: refund.status,
      issued_at: refund.issued_at === null ? null : istTimestamp(refund.issued_at.getTime()),
    })),
  };
}

export function bookingListEntry(
  booking: BookingRecord,
  passengers: readonly PassengerRecord[],
  train: TrainRow,
  now: number,
): Record<string, unknown> {
  const facts = runFacts(booking, train, now);
  return {
    pnr: booking.pnr,
    train: { number: train.number, name: train.name },
    run_date: booking.run_date,
    from: booking.from_code,
    to: booking.to_code,
    class: booking.travel_class,
    state: facts.state,
    summary: passengers
      .map((passenger) => effectiveStatus(passenger.current_status, facts.chartPrepared).label)
      .join(', '),
  };
}

/** The public lookup never carries a name, age, gender, phone, email, account id or fare. */
export function publicPnrBody(
  booking: BookingRecord,
  passengers: readonly PassengerRecord[],
  train: TrainRow,
  now: number,
): Record<string, unknown> {
  const facts = runFacts(booking, train, now);
  return {
    pnr: booking.pnr,
    train: { number: train.number, name: train.name },
    run_date: booking.run_date,
    from: booking.from_code,
    to: booking.to_code,
    class: booking.travel_class,
    chart_prepared: facts.chartPrepared,
    passengers: passengers.map((passenger) => ({
      number: passenger.number,
      booking_status: passenger.booking_status.label,
      current_status: effectiveStatus(passenger.current_status, facts.chartPrepared).label,
    })),
  };
}

import type { BookingRecord } from '../data/bookings';
import { findBooking, loadPassengers } from '../data/bookings';
import { loadTrains } from '../data/trains';
import { chartFullDeduction } from '../domain/bands';
import { POSITION_WORD } from '../domain/berths';
import type { TrainRow } from '../domain/schedule';
import { chartAt } from '../domain/schedule';
import { CHART_NOT_CONFIRMED, isWaitingList } from '../domain/status';
import type { PassengerStatus } from '../domain/status';
import type { AppServices } from '../http/context';
import { TicketStorage, TicketStorageUnavailableError } from '../services/storage';
import { queueMail } from './outbox';
import { applyStatus } from './queues';
import type { TicketPayload } from './tickets';
import { renderTicket, reserveTicketVersion } from './tickets';
import { issuePendingRefunds } from './refunds';

function finalLine(status: PassengerStatus): string {
  switch (status.status) {
    case 'CNF':
      return `${status.label} (coach ${status.coach}, berth ${status.berth}, `
        + `${POSITION_WORD[status.berth_type]})`;
    case 'RAC':
      return `${status.label} (RAC place ${status.position} on coach ${status.coach} `
        + `side lower ${status.berth})`;
    case 'CHART_NOT_CONFIRMED':
      return 'NOT CNF (not confirmed)';
    default:
      return status.label;
  }
}

/** The chart job records the outcome of the chart instant, once per run. */
export async function prepareDueCharts(app: AppServices, now: number): Promise<void> {
  const trains = await loadTrains(app.database);
  const candidates = await app.database.query<{ train_number: string; run_date: string }>(
    `select distinct train_number, run_date::text as run_date
     from bookings where chart_applied = false`,
  );
  for (const candidate of candidates) {
    const train = trains.find((entry) => entry.number === candidate.train_number);
    if (train === undefined) continue;
    const instant = chartAt(train, candidate.run_date);
    if (now < instant) continue;
    await prepareChart(app, train, candidate.run_date, instant).catch(() => undefined);
  }
  await issuePendingRefunds(app);
}

async function prepareChart(
  app: AppServices,
  train: TrainRow,
  runDate: string,
  chartInstant: number,
): Promise<void> {
  await app.database.query(
    `insert into chart_runs (train_number, run_date, prepared_at)
     values ($1, $2, to_timestamp($3 / 1000.0))
     on conflict (train_number, run_date) do nothing`,
    [train.number, runDate, chartInstant],
  );
  const bookings = await app.database.query<{ pnr: string }>(
    `select pnr from bookings
     where train_number = $1 and run_date = $2 and chart_applied = false
     order by pnr`,
    [train.number, runDate],
  );
  for (const entry of bookings) {
    await freezeBooking(app, entry.pnr, train, chartInstant);
  }
}

async function freezeBooking(
  app: AppServices,
  pnr: string,
  train: TrainRow,
  chartInstant: number,
): Promise<void> {
  const booking = await findBooking(app.database, pnr);
  if (booking === null) return;
  const stored = await app.database.transaction(async (tx) => {
    const claim = await tx.query<{ pnr: string }>(
      'select pnr from bookings where pnr = $1 and chart_applied = false for update',
      [pnr],
    );
    if (claim.length === 0) return false;
    const passengers = await loadPassengers(tx, pnr);
    const hadLivePassenger = passengers.some(
      (passenger) => passenger.current_status.status !== 'CAN',
    );
    const notConfirmed: number[] = [];
    for (const passenger of passengers) {
      if (!isWaitingList(passenger.current_status.status)) continue;
      await tx.query('delete from queue_entries where pnr = $1 and passenger_number = $2', [
        pnr, passenger.number,
      ]);
      await applyStatus(tx, pnr, passenger.number, CHART_NOT_CONFIRMED, chartInstant);
      notConfirmed.push(passenger.number);
    }
    const frozen = await loadPassengers(tx, pnr);

    if (notConfirmed.length > 0) {
      const numbers = await tx.query<{ next: number }>(
        'select coalesce(max(number), 0) + 1 as next from cancellations where pnr = $1',
        [pnr],
      );
      const entries = notConfirmed.map((number) => {
        const passenger = frozen.find((candidate) => candidate.number === number);
        return { number, ...chartFullDeduction(passenger === undefined ? 0 : passenger.fare_paise) };
      });
      const refundTotal = entries.reduce((sum, entry) => sum + entry.refund_paise, 0);
      await tx.query(
        `insert into cancellations (pnr, number, requested_at, refund_paise, passengers)
         values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)`,
        [pnr, numbers[0].next, chartInstant, refundTotal, JSON.stringify(entries)],
      );
      if (refundTotal > 0) {
        const refundRows = await tx.query<{ next: number }>(
          'select coalesce(max(number), 0) + 1 as next from refunds where pnr = $1',
          [pnr],
        );
        await tx.query(
          `insert into refunds (pnr, number, reason, refund_paise, status)
           values ($1, $2, 'chart', $3, 'pending')`,
          [pnr, refundRows[0].next, refundTotal],
        );
      }
    }

    const payload = chartTicketPayload(booking, train, frozen);
    const version = await reserveTicketVersion(tx, pnr, 'chart', chartInstant, payload);
    try {
      const { etag } = await app.storage.put(
        TicketStorage.objectKey(pnr, version, 'chart'),
        renderTicket(payload),
      );
      await tx.query('update tickets set stored = true, etag = $3 where pnr = $1 and version = $2', [
        pnr, version, etag,
      ]);
    } catch (error) {
      if (!(error instanceof TicketStorageUnavailableError)) throw error;
    }

    if (hadLivePassenger) {
      const owner = await tx.query<{ email: string }>(
        'select a.email from bookings b join accounts a on a.id = b.account_id where b.pnr = $1',
        [pnr],
      );
      await queueMail(tx, {
        dedupeKey: `chart:${pnr}`,
        to: owner[0].email,
        subject: `Chart prepared: PNR ${pnr}`,
        body: [
          `PNR ${pnr}`,
          `${train.number} ${train.name} on ${booking.run_date}`,
          '',
          ...frozen.map(
            (passenger) => `Passenger ${passenger.number}: ${finalLine(passenger.current_status)}`,
          ),
        ].join('\n'),
      });
    }

    await tx.query(
      'update bookings set chart_applied = true, version = version + 1 where pnr = $1',
      [pnr],
    );
    return true;
  });
  if (stored) await issuePendingRefunds(app);
}

function chartTicketPayload(
  booking: BookingRecord,
  train: TrainRow,
  passengers: readonly { number: number; name: string; age: number; current_status: PassengerStatus }[],
): TicketPayload {
  return {
    pnr: booking.pnr,
    train_number: train.number,
    train_name: train.name,
    run_date: booking.run_date,
    from: booking.from_code,
    to: booking.to_code,
    travel_class: booking.travel_class,
    quota: booking.quota,
    total_paise: booking.total_paise,
    kind: 'chart',
    passengers: passengers.map((passenger) => ({
      number: passenger.number,
      name: passenger.name,
      age: passenger.age,
      label: passenger.current_status.label,
    })),
  };
}

import { UNARRIVED_RIDE_STATES } from "../domain/rideStates";
import { advanceClock, now, syncClock } from "../clock";
import { pool, transaction } from "../db";
import { holdEnd, isDue } from "../domain/deadlines";
import { ratingWindowCloses } from "../domain/ratings";
import { arrivalOf } from "../domain/route";
import { restoreHold, setRequestDeadline } from "../valkey";
import { expireHold, expireRequest, legsOf } from "./bookings";
import { emitClock } from "./events";
import { advanceRide } from "./lifecycle";
import { restoreCodeRates } from "./auth";
import { restoreMessageRates } from "./messages";
import { sweepOutbox } from "./outbox";
import { settleRatings } from "./ratings";
import { deadlineOf, loadBooking, loadRide, type BookingRow } from "./views";

async function expireDueHolds(): Promise<void> {
  const { rows } = await pool.query<{ id: string; ride_id: string }>("SELECT id, ride_id FROM bookings WHERE state = 'held'");
  for (const row of rows) {
    await transaction(async (db) => {
      const ride = await loadRide(db, row.ride_id, true);
      const booking = await loadBooking(db, row.id, true);
      if (ride && booking && booking.state === "held" && isDue(holdEnd(booking.created_at), now())) await expireHold(db, ride, booking);
    });
  }
}

async function expireDueRequests(): Promise<void> {
  const { rows } = await pool.query<{ id: string; ride_id: string }>("SELECT id, ride_id FROM bookings WHERE state = 'requested'");
  for (const row of rows) {
    await transaction(async (db) => {
      const ride = await loadRide(db, row.ride_id, true);
      const booking = await loadBooking(db, row.id, true);
      if (ride && booking && booking.state === "requested" && isDue(deadlineOf(ride, booking), now())) await expireRequest(db, ride, booking);
    });
  }
}

async function advanceDueRides(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM rides WHERE state = ANY($1) AND departure <= $2", [UNARRIVED_RIDE_STATES, now()]);
  for (const row of rows) await transaction((db) => advanceRide(db, row.id).then(() => undefined));
}

async function closeDueWindows(): Promise<void> {
  const { rows } = await pool.query<{ id: string; ride_id: string }>("SELECT id, ride_id FROM bookings WHERE state = 'completed' AND rating_closed = false");
  for (const row of rows) {
    await transaction(async (db) => {
      const ride = await loadRide(db, row.ride_id, true);
      const booking = await loadBooking(db, row.id, true);
      if (ride && booking && booking.state === "completed" && !booking.rating_closed && isDue(ratingWindowCloses(arrivalOf(ride.route)), now())) await settleRatings(db, ride, booking);
    });
  }
}

/** Valkey may lose data: put holds, request deadlines and the message and code counters back from PostgreSQL. */
async function rebuildValkey(): Promise<void> {
  const at = now();
  const { rows } = await pool.query<BookingRow>("SELECT * FROM bookings WHERE state IN ('held', 'requested')");
  for (const booking of rows) {
    const ride = await loadRide(pool, booking.ride_id);
    if (!ride) continue;
    if (booking.state === "held") {
      const remaining = holdEnd(booking.created_at).getTime() - at.getTime();
      if (remaining > 0) await restoreHold(booking.ride_id, legsOf(booking), booking.seat_numbers, booking.id, remaining);
    } else {
      await setRequestDeadline(booking.id, deadlineOf(ride, booking).getTime());
    }
  }
  await restoreMessageRates(pool);
  await restoreCodeRates(pool);
}

const JOBS: (() => Promise<void>)[] = [expireDueHolds, expireDueRequests, advanceDueRides, closeDueWindows, sweepOutbox, rebuildValkey];

let queue: Promise<void> = Promise.resolve();
let pending = 0;

/** Every due job, one pass; passes on one instance never overlap, and several instances may run them at once. */
export function runDueJobs(): Promise<void> {
  pending += 1;
  const pass = queue.then(async () => {
    await syncClock(pool);
    for (const job of JOBS) await job().catch((error: unknown) => console.error(`job ${job.name} failed: ${error instanceof Error ? error.name : "error"}`));
  });
  queue = pass.finally(() => {
    pending -= 1;
  });
  return pass;
}

export function startSweeper(): void {
  setInterval(() => {
    if (pending === 0) void runDueJobs();
  }, 5000);
}

/** The grading clock: move the shared offset, run what became due, then tell every page. */
export async function moveClock(seconds: number): Promise<void> {
  await advanceClock(pool, seconds);
  await runDueJobs();
  await emitClock();
}


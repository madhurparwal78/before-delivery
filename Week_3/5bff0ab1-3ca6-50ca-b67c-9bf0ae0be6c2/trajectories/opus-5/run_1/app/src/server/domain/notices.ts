import { addIstDays, istDate, istInstant } from '../clock.js';
import { newId, type Tx } from '../db.js';

const LOCK_ENDING_HOUR = 12;
const RIDE_REMINDER_HOUR = 18;

export function lockEndingDueAt(expiresAt: Date): Date {
  return istInstant(istDate(expiresAt), LOCK_ENDING_HOUR * 60);
}

export function rideReminderDueAt(startsAt: Date): Date {
  return istInstant(addIstDays(istDate(startsAt), -1), RIDE_REMINDER_HOUR * 60);
}

export async function scheduleLockEnding(
  tx: Tx,
  lockId: string,
  riderId: string,
  expiresAt: Date,
): Promise<void> {
  await tx.query(
    `insert into notices (id, rider_id, kind, state, due_at, lock_id)
     values ($1,$2,'lock_ending','pending',$3,$4)`,
    [newId(), riderId, lockEndingDueAt(expiresAt), lockId],
  );
}

export async function scheduleDeliveryPlace(
  tx: Tx,
  lockId: string,
  riderId: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `insert into notices (id, rider_id, kind, state, due_at, lock_id)
     values ($1,$2,'delivery_place','pending',$3,$4)`,
    [newId(), riderId, now, lockId],
  );
}

export async function cancelLockNotices(tx: Tx, lockId: string): Promise<void> {
  await tx.query(
    `update notices set state = 'cancelled' where lock_id = $1 and kind = 'lock_ending' and state = 'pending'`,
    [lockId],
  );
}

export async function scheduleRideReminder(
  tx: Tx,
  rideId: string,
  riderId: string,
  startsAt: Date,
  bookedAt: Date,
): Promise<void> {
  const dueAt = rideReminderDueAt(startsAt);
  if (bookedAt.getTime() >= dueAt.getTime()) return;
  await tx.query(
    `insert into notices (id, rider_id, kind, state, due_at, ride_id)
     values ($1,$2,'ride_reminder','pending',$3,$4)`,
    [newId(), riderId, dueAt, rideId],
  );
}

/** A moved ride keeps its one reminder, retimed to the slot it now holds. */
export async function retimeRideReminder(tx: Tx, rideId: string, startsAt: Date): Promise<void> {
  await tx.query(
    `update notices set due_at = $2 where ride_id = $1 and kind = 'ride_reminder' and state = 'pending'`,
    [rideId, rideReminderDueAt(startsAt)],
  );
}

export async function cancelRideNotices(tx: Tx, rideId: string): Promise<void> {
  await tx.query(
    `update notices set state = 'cancelled' where ride_id = $1 and state = 'pending'`,
    [rideId],
  );
}

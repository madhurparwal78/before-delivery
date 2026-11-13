import { HUBS, SLOT_MINUTES_FROM_MIDNIGHT, type HubId } from '../../shared/catalogue.js';
import { addIstDays, appNow, istDate, istInstant } from '../clock.js';
import { refreshClockOffset, transact } from '../db.js';
import { bumpAllSeqs, bumpSeq } from './hubstate.js';
import { slotCutOff } from './calendar.js';
import { endClosedWaitLines } from './delivery.js';
import { expireDueLocks } from './locks.js';
import { stepDatesIn } from './pricing.js';

let running: Promise<void> | null = null;

/** Everything the app clock has made due, applied before any state is read or changed. */
export async function settleDue(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const now = appNow();
    await expireDueLocks(now);
    await endClosedWaitLines(now);
  })()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  return running;
}

function hourIndex(at: Date): number {
  return Math.floor((at.getTime() + 330 * 60_000) / 3_600_000);
}

function instantsForHub(hub: HubId, from: Date, to: Date): number {
  let count = 0;
  const dates = new Set([
    istDate(from),
    istDate(to),
    addIstDays(istDate(from), -1),
    addIstDays(istDate(to), 1),
  ]);
  for (const date of dates) {
    for (const minutes of SLOT_MINUTES_FROM_MIDNIGHT) {
      const start = istInstant(date, minutes);
      const cutOff = slotCutOff(start);
      for (const instant of [start, cutOff]) {
        if (instant.getTime() > from.getTime() && instant.getTime() <= to.getTime()) count += 1;
      }
    }
  }
  for (const date of stepDatesIn(hub, istDate(from), istDate(to))) {
    const midnight = istInstant(date, 0);
    if (midnight.getTime() > from.getTime() && midnight.getTime() <= to.getTime()) count += 1;
  }
  return count;
}

/**
 * A hub's sequence also rises at each slot cut-off, each slot start, each whole IST hour
 * and each price step, so open screens repaint at the server's instants.
 */
export async function advanceInstants(): Promise<void> {
  await transact(async (tx) => {
    const row = await tx.one<{ at: Date }>('select at from tick_state where id = 1 for update');
    if (!row) return;
    const from = row.at;
    const to = appNow();
    await tx.query('update tick_state set at = $1 where id = 1', [to]);
    if (to.getTime() <= from.getTime()) return;
    if (hourIndex(to) !== hourIndex(from)) {
      await bumpAllSeqs(tx);
      return;
    }
    for (const h of HUBS) {
      if (instantsForHub(h.id, from, to) > 0) await bumpSeq(h.id, tx);
    }
  });
}

export async function tick(): Promise<void> {
  await refreshClockOffset();
  await settleDue();
  await advanceInstants();
}

import type { FinishId, HubId, ModelId } from '../../shared/catalogue.js';
import type { LiveReading } from '../../shared/types.js';
import { appNow, iso, labelDMonTimeIst } from '../clock.js';
import { lockExpiry } from './calendar.js';
import { hubStatus, stockRows } from './hubstate.js';
import { activeLockOf } from './locks.js';
import { quoteFor } from './pricing.js';
import { effectiveState, hoursLeftOf, lockView, nextFreeSlot } from './views.js';

export async function liveReading(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  callerId: string | null,
): Promise<LiveReading> {
  const now = appNow();
  const status = await hubStatus(hub);
  const stock = await stockRows(hub);
  const forModel = stock.filter((row) => row.model === model);
  const mine = forModel.find((row) => row.finish === finish);
  const preview = lockExpiry(hub, now);
  const lockRow = callerId ? await activeLockOf(callerId, hub, model) : null;
  const lock =
    lockRow && effectiveState(lockRow, now) !== 'expired' ? lockView(lockRow, now) : null;
  return {
    seq: status.seq,
    hub,
    model,
    finish,
    serverNow: iso(now),
    stale: status.stale,
    staleReason: status.staleReason,
    stockAsOf: iso(status.stockAsOf),
    stockAsOfLabel: status.stockAsOfLabel,
    unitsLeft: mine?.unitsLeft ?? 0,
    finishes: forModel.map((row) => ({ finish: row.finish, unitsLeft: row.unitsLeft })),
    quote: quoteFor(model, hub, now),
    nextSlot: await nextFreeSlot(hub, now),
    lockPreview: { expiresAt: iso(preview), expiresLabel: labelDMonTimeIst(preview) },
    lock,
    hoursLeft:
      lock && lock.state === 'locked' && lockRow
        ? hoursLeftOf(lockRow.expires_at, 'locked', now)
        : 0,
  };
}

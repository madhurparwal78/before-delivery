/**
 * Session-close processing. Each trading day's close is processed exactly once,
 * however the market clock reached it and however many requests see it pass.
 */
import { closesUpTo } from '../domain/calendar';
import { formatDateString, parseDateString } from '../shared/nytime';
import { marketClockNow } from './marketClock';
import { earliestUnprocessedCloseDate, processOneSessionClose } from './restatementActions';

let running = false;

export async function processDueSessionCloses(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const nowMs = await marketClockNow();
    const startDateString = await earliestUnprocessedCloseDate();
    if (startDateString === null) return;
    const startDate = parseDateString(startDateString);
    if (startDate === null) return;
    for (const day of closesUpTo(startDate, nowMs)) {
      if (day.closesAt === null) continue;
      await processOneSessionClose(formatDateString(day.date), day.closesAt);
    }
  } finally {
    running = false;
  }
}

export function startSessionCloseTimer(): void {
  setInterval(() => {
    void processDueSessionCloses().catch(() => undefined);
  }, 2000).unref();
}

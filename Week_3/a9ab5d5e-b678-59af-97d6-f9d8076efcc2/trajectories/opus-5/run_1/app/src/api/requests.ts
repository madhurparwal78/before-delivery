import { config } from '../config';
import { Ctx } from '../http/context';

export interface StoredMoments {
  answerBy: number;
  reminderAt: number | null;
}

/** Answer-by and reminder moments are stored when a request is sent, from this process's window. */
export function storedMoments(sentAtMs: number, ceilingMs: number | null): StoredMoments {
  const windowEnd = sentAtMs + config.answerWindowSeconds * 1000;
  const answerBy = ceilingMs === null ? windowEnd : Math.min(windowEnd, ceilingMs);
  const reminderAt = answerBy - config.reminderLeadSeconds * 1000;
  return { answerBy, reminderAt: reminderAt > sentAtMs ? reminderAt : null };
}

export function declineReason(ctx: Ctx): string {
  return ctx.text('reason', 'Give a reason in 1 to 200 characters.', { min: 1, max: 200, multiline: true });
}

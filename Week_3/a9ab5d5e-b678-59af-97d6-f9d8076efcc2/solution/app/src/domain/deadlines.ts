import { config } from '../config';

/** The server clock decides every deadline; these are the only places an answer-by instant meets "now". */
export const LAPSED_SQL = "state = 'sent' AND answer_by <= now()";
export const REPORTED_STATE_SQL = `CASE WHEN ${LAPSED_SQL} THEN 'lapsed' ELSE state END`;
export const REMINDER_DUE_SQL =
  "state = 'sent' AND reminded = false AND reminder_at IS NOT NULL AND reminder_at <= now() AND answer_by > now()";
export const SETTLE_DUE_SQL = "state = 'accepted' AND settle_at IS NOT NULL AND settle_at <= now()";

/** A sent request reads as lapsed from its answer-by instant, before the sweep writes it. */
export function reportedState(state: string, answerBy: Date | null, nowMs: number): string {
  return state === 'sent' && answerBy !== null && answerBy.getTime() <= nowMs ? 'lapsed' : state;
}

interface StoredMoments {
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

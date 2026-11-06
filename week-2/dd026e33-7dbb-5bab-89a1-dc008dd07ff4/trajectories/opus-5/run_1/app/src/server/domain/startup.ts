import { config } from '../config';
import { addSeconds, zurichDate } from '../../shared/zurich';
import type { Startup } from '../../shared/types';

export interface StartupInput {
  readonly scheduled: boolean;
  readonly lastStartupAt: Date | null;
  readonly intakeAt: Date | null;
}

/** The single decision on whether a start-up is overdue and when the next one is due. */
export function startupOf(input: StartupInput, now: Date): Startup {
  if (!input.scheduled) {
    return { scheduled: false, last_at: null, next_due: null, status: 'not_scheduled' };
  }
  const base = input.lastStartupAt ?? input.intakeAt;
  const lastAt = input.lastStartupAt === null ? null : input.lastStartupAt.toISOString();
  if (base === null) {
    return { scheduled: true, last_at: lastAt, next_due: null, status: 'ok' };
  }
  const dueAt = addSeconds(base, config.startupOverdueSeconds);
  return {
    scheduled: true,
    last_at: lastAt,
    next_due: zurichDate(dueAt),
    status: now.getTime() >= dueAt.getTime() ? 'overdue' : 'ok',
  };
}

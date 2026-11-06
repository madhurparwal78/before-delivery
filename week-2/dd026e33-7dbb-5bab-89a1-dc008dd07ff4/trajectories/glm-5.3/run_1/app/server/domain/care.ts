/**
 * Care entries, flags and start-up status — the single decision place.
 */
export const BATTERY_LOW_V = 12.4;
export const TYRE_TOLERANCE_BAR = 0.2;

export type EntryFlag = 'battery_low' | 'tyre_pressure';

export const FLAG_LABELS: Record<EntryFlag, string> = {
  battery_low: 'battery low',
  tyre_pressure: 'tyre pressure off',
};

export interface CareEntryInput {
  started: boolean;
  battery_v: string | null;
  tyres: { fl: string; fr: string; rl: string; rr: string } | null;
  tyreSpecBar: string;
}

export function careFlags(input: CareEntryInput): EntryFlag[] {
  const flags: EntryFlag[] = [];
  if (input.battery_v !== null && Number(input.battery_v) < BATTERY_LOW_V) {
    flags.push('battery_low');
  }
  if (input.tyres !== null) {
    const spec = Number(input.tyreSpecBar);
    const values = [input.tyres.fl, input.tyres.fr, input.tyres.rl, input.tyres.rr].map(Number);
    if (values.some((value) => Math.abs(value - spec) > TYRE_TOLERANCE_BAR + 1e-9)) {
      flags.push('tyre_pressure');
    }
  }
  return flags;
}

export type StartupStatus = 'ok' | 'overdue' | 'not_scheduled';

export interface StartupState {
  scheduled: boolean;
  last_at: string | null;
  next_due: string | null; // YYYY-MM-DD
  status: StartupStatus;
}

/**
 * Start-up status decided by the server only.
 * For a scheduled car: from the last start-up, or intake time if none,
 * `next_due` is that instant plus STARTUP_OVERDUE_SECONDS (a Zurich date).
 * The status is overdue from that instant on.
 */
export function startupState(
  scheduled: boolean,
  lastStartupAt: string | null,
  intakeAt: string | null,
  startupOverdueSeconds: number,
  nowMs: number,
  zurichDateOf: (ms: number) => string,
): StartupState {
  if (!scheduled) {
    return { scheduled: false, last_at: lastStartupAt, next_due: null, status: 'not_scheduled' };
  }
  const baseIso = lastStartupAt ?? intakeAt;
  const baseMs = baseIso !== null ? Date.parse(baseIso) : 0;
  const dueMs = baseMs + startupOverdueSeconds * 1000;
  return {
    scheduled: true,
    last_at: lastStartupAt,
    next_due: zurichDateOf(dueMs),
    status: nowMs >= dueMs ? 'overdue' : 'ok',
  };
}

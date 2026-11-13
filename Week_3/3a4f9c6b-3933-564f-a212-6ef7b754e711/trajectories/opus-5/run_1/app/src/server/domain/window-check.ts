import type { Freeze, SyncWindow, WindowDecision, WindowOpening } from '../../shared/types.js';
import {
  addLocalDays,
  instantFromZonedLocal,
  localDayMinutes,
  localStamp,
  minutesFromHhMm,
  partsInZone,
} from '../../shared/zone.js';

export interface WindowCheckInput {
  instant: Date;
  timeZone: string;
  stage: string;
  windows: SyncWindow[];
  freezes: Freeze[];
  policyVersion: number;
}

/**
 * The one place a sync window decision is made. Freeze beats window, a window's start is
 * inclusive and its end exclusive, and every judgement happens on the cluster's own clock.
 */
export function decideWindow(input: WindowCheckInput): WindowDecision {
  const { instant, timeZone, stage, windows, freezes, policyVersion } = input;
  const base = {
    evaluated_at: instant.toISOString(),
    local_time: localStamp(instant, timeZone),
    policy_version: policyVersion,
  };

  const freeze = freezes.find(
    (candidate) =>
      candidate.stages.includes(stage) &&
      Date.parse(candidate.starts_at) <= instant.getTime() &&
      instant.getTime() < Date.parse(candidate.ends_at),
  );
  if (freeze) {
    return { ...base, open: false, reason: 'freeze', window: null, freeze: { name: freeze.name } };
  }

  if (windows.length === 0) {
    return { ...base, open: true, reason: 'open', window: null, freeze: null };
  }

  const { weekDay, minutes } = localDayMinutes(instant, timeZone);
  const openWindow = windows.find((window) => {
    if (!window.days.includes(weekDay)) return false;
    const start = minutesFromHhMm(window.start);
    const end = minutesFromHhMm(window.end);
    return start !== null && end !== null && minutes >= start && minutes < end;
  });
  if (openWindow) {
    return {
      ...base,
      open: true,
      reason: 'open',
      window: { id: openWindow.id, label: openWindow.label },
      freeze: null,
    };
  }
  return { ...base, open: false, reason: 'outside_window', window: null, freeze: null };
}

function openingOn(
  window: SyncWindow,
  date: { year: number; month: number; day: number },
  timeZone: string,
): WindowOpening | null {
  const startMinutes = minutesFromHhMm(window.start);
  const endMinutes = minutesFromHhMm(window.end);
  if (startMinutes === null || endMinutes === null) return null;

  const opensAt = instantFromZonedLocal(
    { ...date, hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 },
    timeZone,
  );
  if (!window.days.includes(partsInZone(opensAt, timeZone).weekDay)) return null;

  const spillsOver = endMinutes >= 1440;
  const closeDate = spillsOver ? addLocalDays(date, 1) : date;
  const closeMinutes = spillsOver ? endMinutes - 1440 : endMinutes;
  const closesAt = instantFromZonedLocal(
    { ...closeDate, hour: Math.floor(closeMinutes / 60), minute: closeMinutes % 60 },
    timeZone,
  );

  return {
    window_id: window.id,
    label: window.label,
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    local_opens: localStamp(opensAt, timeZone),
    local_closes: localStamp(closesAt, timeZone),
  };
}

/** The next openings of a cluster's windows, chronological, with `opens_at` at or after `from`. */
export function nextOpenings(
  windows: SyncWindow[],
  timeZone: string,
  from: Date,
  count: number,
): WindowOpening[] {
  if (windows.length === 0) return [];
  const found: WindowOpening[] = [];
  let date = addLocalDays(partsInZone(from, timeZone), -1);

  for (let step = 0; step < 380 && found.length < count + windows.length; step += 1) {
    for (const window of windows) {
      const opening = openingOn(window, date, timeZone);
      if (opening && Date.parse(opening.opens_at) >= from.getTime()) found.push(opening);
    }
    date = addLocalDays(date, 1);
  }

  return found.sort((left, right) => left.opens_at.localeCompare(right.opens_at)).slice(0, count);
}

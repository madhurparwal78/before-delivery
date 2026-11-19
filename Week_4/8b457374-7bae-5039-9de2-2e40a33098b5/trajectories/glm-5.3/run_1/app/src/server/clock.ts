import { DateTime } from "luxon";

// The server clock decides everything. The device clock never does.

export interface DeadlineResolution {
  utc: Date;
  /** True when the wall-clock time does not exist in the zone (clock gap). */
  skipped: boolean;
  /** True when the wall-clock time occurs twice; the earlier instant wins. */
  ambiguous: boolean;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isKnownZone(name: string): boolean {
  return DateTime.now().setZone(name).isValid;
}

/**
 * Resolves a local deadline to one exact UTC instant in the campaign's IANA
 * zone. A skipped local time is reported as such; an ambiguous local time
 * takes the earlier of its two instants.
 */
export function resolveLocalDeadline(
  deadlineLocal: string,
  timeZone: string,
): DeadlineResolution | null {
  const match = LOCAL_PATTERN.exec(deadlineLocal);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  const zone = DateTime.now().setZone(timeZone).zone;
  if (zone === null) return null;

  // Enumerate candidate zone offsets around the local time: the offsets in
  // force well before, well after, and at the local time itself. Covering the
  // transition window both ways catches gaps and repeated hours alike.
  const base = DateTime.utc(year, month, day, hour, minute, second);
  const offsets = new Set<number>();
  for (const shiftMinutes of [-36 * 60, 36 * 60, 0]) {
    const probe = base.plus({ minutes: shiftMinutes }).setZone(timeZone);
    offsets.add(probe.offset);
  }

  const instants: Date[] = [];
  for (const offset of offsets) {
    const instant = base.minus({ minutes: offset });
    const roundTrip = instant.setZone(timeZone);
    if (
      roundTrip.year === year &&
      roundTrip.month === month &&
      roundTrip.day === day &&
      roundTrip.hour === hour &&
      roundTrip.minute === minute &&
      roundTrip.second === second
    ) {
      instants.push(instant.toJSDate());
    }
  }

  if (instants.length === 0) {
    return { utc: base.toJSDate(), skipped: true, ambiguous: false };
  }
  instants.sort((a, b) => a.getTime() - b.getTime());
  return { utc: instants[0], skipped: false, ambiguous: instants.length > 1 };
}

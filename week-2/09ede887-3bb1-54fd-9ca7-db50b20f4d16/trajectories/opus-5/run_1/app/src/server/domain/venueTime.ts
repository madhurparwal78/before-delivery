export const VENUE_ZONE = 'America/Halifax';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The venue wall-clock reading of an instant, as minutes since the Unix epoch. */
function venueWallMinutes(instant: Date): number {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`missing ${type} in venue time parts`);
    return Number(part.value);
  };
  return Math.floor(
    Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second')) / 60_000,
  );
}

/**
 * The instant at which the venue clock reads the given date and wall-clock time.
 * A reading inside a repeated hour resolves to its first, daylight, occurrence.
 */
export function venueWallClockToInstant(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    throw new Error(`cannot read venue wall clock ${date} ${time}`);
  }
  const wanted = Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 60_000);
  // Offsets in this zone lie within a day of UTC, so two corrections always converge.
  let candidate = wanted;
  for (let round = 0; round < 3; round += 1) {
    candidate = wanted - (venueWallMinutes(new Date(candidate * 60_000)) - candidate);
  }
  const earlier = candidate - 60;
  if (venueWallMinutes(new Date(earlier * 60_000)) === wanted) candidate = earlier;
  return new Date(candidate * 60_000);
}

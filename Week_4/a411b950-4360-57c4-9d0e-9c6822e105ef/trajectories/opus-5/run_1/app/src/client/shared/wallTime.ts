function offsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = read('hour') === 24 ? 0 : read('hour');
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
  return asUtc - instant.getTime();
}

/** Reads a `YYYY-MM-DDTHH:MM` wall time as the instant it names in the given time zone. */
export function wallTimeToInstant(wall: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (match === null) return null;
  const naive = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const firstGuess = naive - offsetMilliseconds(new Date(naive), timeZone);
  const offset = offsetMilliseconds(new Date(firstGuess), timeZone);
  return new Date(naive - offset);
}

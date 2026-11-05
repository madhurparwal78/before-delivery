const STUDIO_TIME_ZONE = 'America/Chicago';

const labelFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TIME_ZONE,
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A studio time written as `Sat 9:15 PM`. */
export function studioLabel(at: Date): string {
  const parts = labelFormat.formatToParts(at);
  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${find('weekday')} ${find('hour')}:${find('minute')} ${find('dayPeriod')}`;
}

/** The studio date as `YYYY-MM-DD`. */
export function studioDate(at: Date): string {
  return dateFormat.format(at);
}

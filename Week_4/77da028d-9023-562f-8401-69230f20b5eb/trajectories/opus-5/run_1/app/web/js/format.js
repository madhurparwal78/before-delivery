const WEEKDAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

/** `<H> h <MM> min`, rounded down to the whole minute. */
export function duration(seconds) {
  if (seconds < 0) return `Over by ${duration(-seconds)}`;
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** The weekday, day without a leading zero, month name and year. */
export function longDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const weekday = WEEKDAYS[(Date.UTC(year, month - 1, day) / 86400000 + 3) % 7];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** Site-local `HH:MM` taken straight from a site-local ISO instant. */
export function hhmm(isoLocal) {
  return isoLocal.slice(11, 16);
}

export function isoDateOf(isoLocal) {
  return isoLocal.slice(0, 10);
}

/** The UTC offset of a site-local ISO instant, as `+HH:MM`. */
export function offsetOf(isoLocal) {
  return isoLocal.slice(19);
}

export function countdown(minutes) {
  const whole = Math.max(0, Math.floor(minutes));
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`;
}

export function oneDecimal(value) {
  return Number(value).toFixed(1);
}

/** A record timestamp in UTC rendered as site-local `YYYY-MM-DD HH:MM`. */
export function siteStamp(isoUtc, timeZone) {
  if (!isoUtc) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoUtc));
  const of = (type) => parts.find((part) => part.type === type).value;
  return `${of('year')}-${of('month')}-${of('day')} ${of('hour')}:${of('minute')}`;
}

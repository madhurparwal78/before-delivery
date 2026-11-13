export const LEAGUE_TIME_ZONE = 'Europe/Dublin';

const DEADLINE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LEAGUE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The published `<deadline>` format, such as "Sat 8 Nov 13:30". */
export const formatLeagueDeadline = (iso: string): string => {
  const parts = DEADLINE_FORMAT.formatToParts(new Date(iso));
  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${find('weekday')} ${find('day')} ${find('month')} ${find('hour')}:${find('minute')}`;
};

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LEAGUE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A short league-time stamp for notices, such as "8 Nov 13:30". */
export const formatLeagueStamp = (iso: string): string => STAMP_FORMAT.format(new Date(iso));

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: LEAGUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The league date, as YYYY-MM-DD. */
export const leagueDate = (date: Date): string => DATE_FORMAT.format(date);

const OFFSET_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LEAGUE_TIME_ZONE,
  timeZoneName: 'longOffset',
});

/** The league time zone's UTC offset in minutes at the given instant. */
export const leagueOffsetMinutes = (at: Date): number => {
  const name =
    OFFSET_FORMAT.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
};

/** Turns league-time "YYYY-MM-DD HH:MM" into an ISO 8601 stamp with an offset. */
export const leagueLocalToIso = (text: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const [, year, month, day, hour, minute] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  const offset = leagueOffsetMinutes(new Date(naive - leagueOffsetMinutes(new Date(naive)) * 60000));
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:00${sign}${pad(Math.trunc(absolute / 60))}:${pad(absolute % 60)}`;
};

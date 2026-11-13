export function formatMillions(tenths: number): string {
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  const whole = Math.floor(abs / 10);
  const frac = abs % 10;
  return `${sign}${whole}.${frac}`;
}

export function formatMillionsLabel(tenths: number): string {
  return `${formatMillions(tenths)}m`;
}

export function formatHit(points: number): string {
  return points === 0 ? '0' : String(-points);
}

export interface DeadlineParts {
  weekday: string;
  day: string;
  month: string;
  time: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function describeDeadline(leagueTime: Date): DeadlineParts {
  const weekday = WEEKDAYS[leagueTime.getUTCDay()];
  const day = String(leagueTime.getUTCDate());
  const month = MONTHS[leagueTime.getUTCMonth()];
  const hours = String(leagueTime.getUTCHours()).padStart(2, '0');
  const minutes = String(leagueTime.getUTCMinutes()).padStart(2, '0');
  return { weekday, day, month, time: `${hours}:${minutes}` };
}

export function formatDeadline(leagueTime: Date): string {
  const parts = describeDeadline(leagueTime);
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.time}`;
}

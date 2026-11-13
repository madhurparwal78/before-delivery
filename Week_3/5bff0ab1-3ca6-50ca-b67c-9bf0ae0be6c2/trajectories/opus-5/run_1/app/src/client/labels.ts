const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Labels made from a server-given IST date alone, never from the device clock. */
export function labelDMon(date: string): string {
  const [, month, day] = date.split('-').map((part) => Number(part));
  return `${day} ${MONTH[(month as number) - 1]}`;
}

export function labelDddDMon(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const weekday = new Date(
    Date.UTC(year as number, (month as number) - 1, day as number),
  ).getUTCDay();
  return `${WEEKDAY[weekday]} ${labelDMon(date)}`;
}

/** `30 Oct, 6:00 pm IST` to its parts, so published strings can be rebuilt exactly. */
export function withoutIstSuffix(label: string): string {
  return label.replace(/\s*IST$/, '');
}

/** `11:30 am IST` to the cluster's `11:30`. */
export function clusterTimeFromLabel(label: string): string {
  const match = /^(\d{1,2}:\d{2})/.exec(label);
  return match ? (match[1] as string) : '--:--';
}

/** The full weekday name from a server expiry label's date part. */
export function weekdayNameOf(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const weekday = new Date(
    Date.UTC(year as number, (month as number) - 1, day as number),
  ).getUTCDay();
  return [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][weekday] as string;
}

/** `6:00 pm` to `6 pm`, for the Garage statement. */
export function hourOnly(time: string): string {
  const match = /^(\d{1,2}):\d{2}\s(am|pm)$/.exec(time);
  return match ? `${match[1]} ${match[2]}` : time;
}

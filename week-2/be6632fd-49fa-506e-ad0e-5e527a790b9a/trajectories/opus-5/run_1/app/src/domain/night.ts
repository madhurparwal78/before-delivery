/** A local time from 22:00 up to but not including 07:00 is Night. */
export function isNight(localTime: string): boolean {
  const hour = Number(localTime.slice(0, 2));
  return hour >= 22 || hour < 7;
}

/** Day names and month names for the screen's date reading: <Ddd D Mon YYYY>. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** weekday index 1=Monday..7=Sunday */
export function weekdayName(dow: number): string {
  return WEEKDAYS[dow - 1];
}

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

export interface ScreenDate {
  year: number;
  month: number; // 1-12
  day: number;
  dow: number;  // 1=Monday..7=Sunday
}

/** `Fri 12 Jun 2026` */
export function screenDate(d: ScreenDate): string {
  return `${weekdayName(d.dow)} ${d.day} ${monthName(d.month)} ${d.year}`;
}

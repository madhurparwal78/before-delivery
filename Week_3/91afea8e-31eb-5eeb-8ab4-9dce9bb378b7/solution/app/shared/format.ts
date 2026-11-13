/** Display formatting only: money maths stays in integer paise. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(paise) / 100);
  const fraction = String(Math.abs(paise) % 100).padStart(2, "0");
  const digits = String(whole);
  const grouped =
    digits.length > 3
      ? `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`
      : digits;
  return `${sign}₹${grouped}.${fraction}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `YYYY-MM-DD` to `Thu 5 Nov`. */
export function promiseText(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

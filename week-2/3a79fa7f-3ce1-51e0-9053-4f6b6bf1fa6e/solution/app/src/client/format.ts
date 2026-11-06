// Display formats of Feedback states: amounts as $X,XXX.XX and dates in UTC. Formatting only, never maths.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function price(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rest = abs % 100;
  const dollars = String((abs - rest) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(rest).padStart(2, "0")}`;
}

export function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${longDate(iso)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "D Mon YYYY" for a calendar date string YYYY-MM-DD. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]?.slice(0, 3)} ${y}`;
}

/** "Thu, Oct 29" for a calendar date string YYYY-MM-DD, read as that date with no time-zone shift. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${MONTHS[m - 1]?.slice(0, 3)} ${d}`;
}

/** A rate in pcm (per 100,000) as a percentage without trailing zeros: 5000 is "5%", 9975 is "9.975%". */
export function percent(ratePcm: number): string {
  const fraction = String(ratePcm % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${Math.floor(ratePcm / 1000)}${fraction ? `.${fraction}` : ""}%`;
}

export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

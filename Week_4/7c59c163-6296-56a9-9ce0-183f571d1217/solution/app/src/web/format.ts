/** A server timestamp shown in the venue's time zone. */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `D Month YYYY` from a Kill Bill `YYYY-MM-DD` date, without going through the device clock. */
export function longDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

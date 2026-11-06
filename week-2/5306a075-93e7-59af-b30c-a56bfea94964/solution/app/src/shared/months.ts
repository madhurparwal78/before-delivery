const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The YYYY-MM month of a calendar date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** "2027-03" → "March 2027": the English month name and year of a YYYY-MM month. */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
}

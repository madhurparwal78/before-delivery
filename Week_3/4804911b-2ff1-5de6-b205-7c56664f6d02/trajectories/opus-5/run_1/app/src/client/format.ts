const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Prices arrive as integer paise and are printed, never recomputed. */
export function rupees(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const fraction = Math.abs(paise % 100);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Every date on screen is formatted from the server's YYYY-MM-DD string. */
export function dayMonthYear(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function grams(milligrams: number): string {
  const tenths = Math.floor((2 * milligrams + 100) / 200) / 10;
  return `${tenths.toFixed(1)} g`;
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

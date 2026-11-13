import { isRealDay } from "./clock.js";

/** `<plant>-<YYMMDD>-<line>`: 2 to 12 capital letters, a real date in the 2000s, 1 to 4 digits. */
export function parseBatchCode(code: string): { packedDate: string } | null {
  const m = /^[A-Z]{2,12}-(\d{2})(\d{2})(\d{2})-\d{1,4}$/.exec(code);
  if (!m) return null;
  const packedDate = `20${m[1]}-${m[2]}-${m[3]}`;
  return isRealDay(packedDate) ? { packedDate } : null;
}

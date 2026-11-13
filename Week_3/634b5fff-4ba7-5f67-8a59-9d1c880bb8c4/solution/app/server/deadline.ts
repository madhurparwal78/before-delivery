import { businessNow, copenhagenInstant, copenhagenTime } from "./clock.js";
import { config } from "./config.js";

const BANKING_DAYS = 3;
const HOLIDAYS = new Set(["12-24", "12-25", "12-26", "12-31", "01-01"]);

const isBankingDay = (date: Date): boolean => {
  const weekday = date.getUTCDay();
  const key = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(key);
};

/**
 * The single place where the bank-transfer deadline is decided: 23:59:59 Copenhagen time on the third banking day
 * after the order, or TRANSFER_SECONDS after the order when that setting is present.
 */
export const transferDeadline = (orderedAt: Date = businessNow()): Date => {
  if (config.transferSeconds !== null) return new Date(orderedAt.getTime() + config.transferSeconds * 1000);
  const ordered = copenhagenTime(orderedAt);
  const day = new Date(Date.UTC(ordered.year, ordered.month - 1, ordered.day));
  let counted = 0;
  while (counted < BANKING_DAYS) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (isBankingDay(day)) counted += 1;
  }
  const lastSecond = copenhagenInstant({
    year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: 23, minute: 59, second: 59,
  });
  return new Date(lastSecond.getTime() + 999);
};

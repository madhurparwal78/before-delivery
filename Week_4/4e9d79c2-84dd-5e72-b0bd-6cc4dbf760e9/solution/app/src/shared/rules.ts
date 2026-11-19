// The published form and enquiry rules, decided here for the server and the page alike.
import { daysBetween, isMissingHour, isRealDate, isRepeatedHour, isTime, longDate, toInstant, type LocalDateTime } from "./time.js";

/** Lengths count characters as a reader does: an emoji counts as 1. */
export const readerLength = (text: string): number => {
  let count = 0;
  for (const _ of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) count += 1;
  return count;
};

export const foldEmail = (email: string): string => email.replace(/\s+/g, "").toLowerCase();
export const foldTelephone = (telephone: string): string => {
  const digits = telephone.replace(/\D/g, "");
  return digits.startsWith("44") ? `0${digits.slice(2)}` : digits;
};
export const foldName = (name: string): string =>
  name.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/\s+/g, "").toLowerCase();

export const isEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
export const isUkTelephone = (telephone: string): boolean => {
  if (/[^\d\s+()-]/.test(telephone)) return false;
  return /^0\d{9,10}$/.test(foldTelephone(telephone));
};

export const COPY = {
  occasion: "Choose an occasion.",
  from: "Enter the pick-up address.",
  to: "Enter the destination.",
  date: "Enter a date as DD/MM/YYYY.",
  hour: "Choose an hour and minutes.",
  people: "Enter between 1 and 400 people.",
  bags: "Enter between 0 and 40 bags.",
  wheelchairs: "Enter between 0 and 10 wheelchair users.",
  details: "Describe the stops in up to 2,000 characters.",
  name: "Enter your name.",
  email: "Enter a real email address.",
  telephone: "Enter a UK telephone number.",
  past: "That date has passed. Choose today or a later date.",
  noHours: "No more pick-ups today.",
  notice: "We need at least 30 minutes' notice for a pick-up.",
  returnEarly: "The return has to be after the pick-up.",
} as const;
const missingHourCopy = (time: string, date: string): string =>
  `${time} does not exist on ${longDate(date)}, when the clocks go forward. Choose another time.`;
const whichTimeCopy = (time: string): string => `Choose which ${time} you mean.`;

const QUARTERS = /^\d\d:(00|15|30|45)$/;

/** The refusal for a typed pick-up, in the published order, or null when it may stand. `now` is whole UTC seconds. */
export const pickupRefusal = (at: Partial<LocalDateTime> | null | undefined, now: number, today: string): string | null => {
  if (!at || typeof at.date !== "string" || !isRealDate(at.date)) return COPY.date;
  if (!isTime(at.time) || !QUARTERS.test(at.time)) return COPY.hour;
  if (daysBetween(today, at.date) < 0) return COPY.past;
  if (isMissingHour(at.date, at.time)) return missingHourCopy(at.time, at.date);
  if (isRepeatedHour(at.date, at.time) && at.repeatedHour !== "first" && at.repeatedHour !== "second") return whichTimeCopy(at.time);
  const wholeMinute = now - (now % 60);
  if (toInstant(at as LocalDateTime) - wholeMinute < 30 * 60) return COPY.notice;
  return null;
};

export const returnRefusal = (back: Partial<LocalDateTime> | null | undefined, out: LocalDateTime): string | null => {
  if (!back || typeof back.date !== "string" || !isRealDate(back.date)) return COPY.date;
  if (!isTime(back.time) || !QUARTERS.test(back.time)) return COPY.hour;
  if (isMissingHour(back.date, back.time)) return missingHourCopy(back.time, back.date);
  if (isRepeatedHour(back.date, back.time) && back.repeatedHour !== "first" && back.repeatedHour !== "second") return whichTimeCopy(back.time);
  if (toInstant(back as LocalDateTime) <= toInstant(out)) return COPY.returnEarly;
  return null;
};

/** The refusal for a date-time typed on the desk, where only the missing hour is ruled out. */
export const missingHourGuard = (at: Partial<LocalDateTime> | null | undefined): string | null => {
  if (!at || typeof at.date !== "string" || !isRealDate(at.date)) return COPY.date;
  if (!isTime(at.time)) return COPY.hour;
  return isMissingHour(at.date, at.time) ? missingHourCopy(at.time, at.date) : null;
};

export const wholeInRange = (value: unknown, low: number, high: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;

export const peopleCount = (people: number): string => `${people} ${people === 1 ? "person" : "people"}`;
export const OCCASION_LABELS: Record<string, string> = { school: "School", weddings: "Weddings", company: "Company", festivals: "Festivals and sport" };
export const JOURNEY_LABELS: Record<string, string> = { oneWay: "One way", return: "Return", sameDayReturn: "Same day return", severalStops: "Several stops" };
/** Prints a money string from the API ("1157.25") in the published form. */
export const printedMoney = (plain: string): string => {
  const [whole, part] = plain.replace("-", "").split(".");
  return `${plain.startsWith("-") ? "-" : ""}£${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part}`;
};
export const money = (pennies: number): string => printedMoney(`${pennies < 0 ? "-" : ""}${Math.floor(Math.abs(pennies) / 100)}.${String(Math.abs(pennies) % 100).padStart(2, "0")}`);

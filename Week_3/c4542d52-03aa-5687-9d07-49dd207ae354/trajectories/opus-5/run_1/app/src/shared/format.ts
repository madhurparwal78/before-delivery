import type { VestingType } from "./types.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Groups the whole part of an exact decimal string in thousands. */
export function groupDecimal(text: string): string {
  const [whole, fraction] = text.split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatMoney(text: string): string {
  return `$${groupDecimal(text)}`;
}

export function formatPricePerShare(text: string): string {
  return `$${groupDecimal(text)}`;
}

/** A date as "28 Feb 2027". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  const index = Number(month ?? "1") - 1;
  return `${Number(day ?? "1")} ${MONTHS[index] ?? ""} ${year ?? ""}`;
}

const pacificInstant = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** An instant as "28 Feb 2027, 17:04:05 PT", always in Tidecraft's time zone. */
export function formatInstant(iso: string): string {
  const parts = pacificInstant.formatToParts(new Date(iso));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const month = MONTHS[Number(read("month")) - 1] ?? "";
  return `${Number(read("day"))} ${month} ${read("year")}, ${read("hour")}:${read("minute")}:${read("second")} PT`;
}

/** A remaining time as "7d 00:00:00". */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function vestingLabel(type: VestingType): string {
  return type === "standard" ? "4 years, 1-year cliff" : "4 years monthly, no cliff";
}

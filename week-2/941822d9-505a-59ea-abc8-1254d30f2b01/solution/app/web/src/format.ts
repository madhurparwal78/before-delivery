import type { CourseState, Enrolment, EnrolmentState, User } from "./api";

// Display formatting only: every amount, hour and date arrives from the API already decided.

/** The provider's time zone (brief: Seed data), used to show instants as provider calendar dates. */
const PROVIDER_TIME_ZONE = "America/Chicago";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `<Mon D, YYYY>` for a provider calendar date (YYYY-MM-DD). */
export function monDYyyy(date: string): string {
  const [year, month, day] = date.split("-");
  return `${MONTHS[parseInt(month ?? "1", 10) - 1] ?? ""} ${parseInt(day ?? "1", 10)}, ${year ?? ""}`;
}

/** "Oct 2026" for a YYYY-MM month. */
export const monthLabel = (month: string): string => `${MONTHS[parseInt(month.slice(5, 7), 10) - 1] ?? ""} ${month.slice(0, 4)}`;

/** The provider calendar date of an instant. */
export function providerDate(instant: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PROVIDER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    typeof instant === "string" ? new Date(instant) : instant,
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const instantDate = (instant: string): string => monDYyyy(providerDate(instant));

export const closeLine = (closeDate: string): string => `Enrolment closes ${monDYyyy(closeDate)} at 11:59 PM CT`;

export const STATE_LABELS: Record<CourseState, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  withdrawn: "Withdrawn",
};

export const ENROLMENT_LABELS: Record<EnrolmentState, string> = {
  held: "Held",
  confirmed: "Enrolled",
  completed: "Completed",
  certified: "Certified",
  refunded: "Refunded",
  withdrawn: "Withdrawn",
};

export const formatLabel = (format: "self_paced" | "cohort"): string => (format === "self_paced" ? "Self-paced" : "Live cohort");

export function fundingLabel(enrolment: Pick<Enrolment, "funding">, user: User | null): string {
  const hospital = user?.organisation?.kind === "hospital" ? user.organisation.name : "Hospital";
  if (enrolment.funding === "card") return "Your card";
  if (enrolment.funding === "co_pay") return `Card + ${hospital}`;
  return `${hospital} seat`;
}

/** Quarter-hour steps of an hours string ("1.25" -> 5), for the seal numeral's count-up. */
export function quarterSteps(hours: string): number {
  const [whole, fraction] = hours.split(".");
  const hundredths = parseInt(fraction ?? "0", 10);
  return parseInt(whole ?? "0", 10) * 4 + (hundredths - (hundredths % 25)) / 25;
}

export const quarterText = (steps: number): string => `${(steps - (steps % 4)) / 4}.${String((steps % 4) * 25).padStart(2, "0")}`;

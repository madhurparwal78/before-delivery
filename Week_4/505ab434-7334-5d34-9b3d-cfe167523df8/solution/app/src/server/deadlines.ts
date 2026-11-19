// Deadline arithmetic from the tier of an application (brief: Business rules / Deadlines). All instants are ISO strings.
import { config } from "./config.ts";
import { applicationOf } from "../shared/domain.ts";
import { toIso } from "../shared/dates.ts";

const HOUR_MS = 3_600_000;

/** Length of the review window of an application class, in milliseconds. */
function windowMs(applicationClass: string): number {
  return config.deadlineHours[applicationOf(applicationClass)!.tier] * HOUR_MS;
}

export const deadlineFor = (submittedAt: string, applicationClass: string): string =>
  toIso(Date.parse(submittedAt) + windowMs(applicationClass));

export const warningAt = (submittedAt: string, applicationClass: string): string =>
  toIso(Date.parse(submittedAt) + (windowMs(applicationClass) * config.deadlineWarningPercent) / 100);

export const ceilingAt = (submittedAt: string, applicationClass: string): string =>
  toIso(Date.parse(submittedAt) + windowMs(applicationClass) * config.expiryCeilingMultiplier);

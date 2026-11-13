import { config } from "./config.js";
import { addSeconds } from "./time.js";

/** An offer lapses the instant the server clock reaches its expiry; the end is exclusive. */
export const offerHasLapsed = (expiresAt: Date | null, at: Date): boolean => expiresAt !== null && expiresAt <= at;

/** A leaver's exercise window ends the instant the server clock reaches its end; the end is exclusive. */
export const windowHasEnded = (endsAt: Date | null, at: Date): boolean => endsAt !== null && endsAt <= at;

/** A tender closes the instant the server clock reaches its close time; the end is exclusive. */
export const tenderHasClosed = (closesAt: Date, at: Date): boolean => closesAt <= at;

export const offerWarningAt = (expiresAt: Date): Date => addSeconds(expiresAt, -config.offerWarningSeconds);

export function offerExpiry(offeredAt: Date): Date {
  return addSeconds(offeredAt, config.offerWindowSeconds);
}

export function leaverWindowEnd(terminatedAt: Date): Date {
  return addSeconds(terminatedAt, config.leaverWindowSeconds);
}

/** The leaver warning instants still ahead when the departure was recorded, earliest first. */
export function leaverWarnings(terminatedAt: Date, windowEndsAt: Date): Date[] {
  return config.leaverWarningsSeconds
    .map((seconds) => addSeconds(windowEndsAt, -seconds))
    .filter((at) => at > terminatedAt)
    .sort((a, b) => a.getTime() - b.getTime());
}

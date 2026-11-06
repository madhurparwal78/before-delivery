import { wallClock, type TimeZone } from "../../shared/format.js";
import { conflict, illegalTransition } from "../http/errors.js";

// The tender lifecycle (brief: Tenders, Sealed bids): draft, open, closed, opened, awarded. `closed` is never
// stored: an open tender counts as closed from its close instant onward, judged by the server's clock.

type StoredStatus = "draft" | "open" | "opened" | "awarded";
export type TenderStatus = StoredStatus | "closed";
export const MAX_BIDDERS = 12;

/** A stored tender's status and close: only a draft may have no close yet. */
export type TenderClock =
  | { status: "draft"; closes_at: Date | null }
  | { status: "open" | "opened" | "awarded"; closes_at: Date };
/** A tender bidders can see: every one but a draft. */
export type PublishedClock = Exclude<TenderClock, { status: "draft" }>;

export function tenderStatus(tender: TenderClock, now: Date = new Date()): TenderStatus {
  return tender.status === "open" && now.getTime() >= tender.closes_at.getTime() ? "closed" : tender.status;
}

type TenderAction = "save_draft" | "publish" | "move_close" | "open_bids" | "level" | "award";

/**
 * The studio controls each status offers. Open bids is offered while open too, so pressing it early
 * answers with the close instant from which bids can be opened.
 */
export function studioActions(status: TenderStatus): TenderAction[] {
  const offered: Record<TenderStatus, TenderAction[]> = {
    draft: ["save_draft", "publish"],
    open: ["move_close", "open_bids"],
    closed: ["open_bids"],
    opened: ["level", "award"],
    awarded: [],
  };
  return offered[status];
}

/** Publish: only from draft. */
export function assertPublish(status: TenderStatus): void {
  if (status !== "draft") throw illegalTransition(status, "publish");
}

/** Which setup fields a PATCH may carry in each state; anything else is an illegal change. */
export function assertPatch(status: TenderStatus, fields: string[]): void {
  const allowed: Record<TenderStatus, string[]> = {
    draft: ["title", "scope", "closesAtLocal", "contingencyPercent", "bidders"],
    open: ["closesAtLocal"],
    closed: [],
    opened: ["contingencyPercent"],
    awarded: [],
  };
  if (!fields.length || fields.some((field) => !allowed[status].includes(field))) throw illegalTransition(status, "edit");
}

/** Open bids: only once closed; before close it is still open. */
export function assertOpenBids(tender: TenderClock, now: Date = new Date()): void {
  if (tender.status === "open") {
    if (now.getTime() < tender.closes_at.getTime()) throw conflict("tender_still_open", { closesAt: tender.closes_at.toISOString() });
    return;
  }
  throw illegalTransition(tender.status, "open_bids");
}

/** Levelling and award need the bids opened. */
export function assertOpened(status: TenderStatus, action: string): void {
  if (status !== "opened") throw illegalTransition(status, action);
}

/** A bid or amendment is accepted only when the server received it before the close instant. */
export function assertBidWindow(tender: PublishedClock, receivedAt: Date): void {
  if (tender.status !== "open" || receivedAt.getTime() >= tender.closes_at.getTime()) {
    throw conflict("tender_closed", { closedAt: tender.closes_at.toISOString() });
  }
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** The UTC instant of a wall-clock time `YYYY-MM-DDTHH:mm:ss` in a zone, or null when it is not one. */
export function localToUtc(local: string, zone: TimeZone): Date | null {
  const found = LOCAL.exec(local);
  if (!found) return null;
  const [year, month, day, hour, minute, second] = found.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const shown = wallClock(check, zone);
  const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second) - guess;
  return new Date(guess - offset);
}

/** A tender's contingency percentage as its published decimal string, from basis points. */
export const percentText = (basisPoints: number): string =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;

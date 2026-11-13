import { ApiFailure, request, type ApiReply, type RequestInitJson } from "../api.js";
import { ERRORS, STAFF_COPY, WAITING_HEADER } from "../../../shared/copy.js";
import { Store } from "../state/store.js";

/** What every staff page shares: the one `Staff status` sentence and the staff API calls that feed its waiting notice. */

export const said = new Store<{ text: string; failed: boolean } | null>(null);
export const waiting = new Store<string | null>(null);

/** Replaces the sentence in `status "Staff status"`; `null` hands it back to the waiting notice. */
export const say = (text: string | null, failed = false): void => said.set(text === null ? null : { text, failed });

/** The waiting notice of the latest staff response: events first, then phone alerts. */
const waitingNotice = (headers: Headers): string | null => {
  const named = (headers.get(WAITING_HEADER) ?? "").split(",").map((part) => part.trim());
  if (named.includes("queue")) return STAFF_COPY.eventsWaiting;
  if (named.includes("alerts")) return STAFF_COPY.alertsWaiting;
  return null;
};

export const call = async <T,>(method: string, path: string, init?: RequestInitJson): Promise<ApiReply<T>> => {
  const reply = await request<T>(method, path, init);
  waiting.set(waitingNotice(reply.headers));
  return reply;
};

/** The published sentence of a failed call. */
export const failureText = (error: unknown): string => {
  if (error instanceof ApiFailure) return error.message || ERRORS[error.code === "network" ? "internal_error" : error.code].message();
  return ERRORS.internal_error.message();
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

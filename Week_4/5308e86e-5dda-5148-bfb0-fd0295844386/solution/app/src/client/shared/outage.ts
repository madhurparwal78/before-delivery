/** Outage announcements: "can't be reached" once per outage, "back online" once when figures refresh again. */
import { announce } from "./announce.js";
import { COPY } from "./copy.js";

let inOutage = false;

/** A refresh could not reach the server. Announces the first failure of an outage only. */
export function refreshFailed(): void {
  if (inOutage) return;
  inOutage = true;
  announce(COPY.outage);
}

/** A refresh succeeded. Announces the recovery if it followed a failure. */
export function refreshSucceeded(): void {
  if (!inOutage) return;
  inOutage = false;
  announce(COPY.backOnline);
}

/** A user's own action could not reach the server: announced every time, and refreshes stay quiet until recovery. */
export function actionFailed(): void {
  inOutage = true;
  announce(COPY.outage);
}

/** A user action succeeded again; its own message is announced instead of the recovery. */
export function actionSucceeded(): void {
  inOutage = false;
}

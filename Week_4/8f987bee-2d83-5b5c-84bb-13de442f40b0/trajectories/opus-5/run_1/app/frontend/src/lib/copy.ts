import { RequestError } from "./api";

export const DATABASE_OUTAGE_COPY =
  "Wayline can't reach its database right now. It keeps retrying on its own.";
export const OUTAGE_COPY = "Wayline couldn't confirm this action. Check the list before trying again.";
export const PERMISSION_COPY = "You don't have permission to do that.";
export const UNREADABLE_YAML_COPY = "This YAML can't be read. Fix it before switching tabs.";
export const DRAFT_RESTORED_COPY = "Signed in again. Your connection draft is restored.";
export const VERSION_MISMATCH_COPY =
  "This connection changed since you opened it. Showing the latest version.";
export const SYNC_RUNNING_COPY = "A sync is already running for this connection.";
export const CONNECTION_INACTIVE_COPY = "This connection is paused. Turn it on to sync.";
export const BAD_PAGE_LINK_COPY = "This page link is no longer valid.";

/** The copy every refusal with no field errors of its own shows. */
export function generalCopy(error: RequestError): string | null {
  if (error.code === "service_unavailable") return DATABASE_OUTAGE_COPY;
  if (error.status === 403) return PERMISSION_COPY;
  if (error.status === 0 || error.status >= 500) return OUTAGE_COPY;
  return null;
}

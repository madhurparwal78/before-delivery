import { databaseReady, first } from "../db/pool";
import { pendingMail } from "../services/outbox";
import { searchReachable } from "../services/search";
import { pendingSearchSync } from "../services/searchSync";
import { inboxReachable, smtpReachable } from "../services/smtp";
import { storageReachable } from "../services/storage";
import type { FounderHealth, ServiceState } from "../../shared/api";

const state = (reachable: boolean): ServiceState => (reachable ? "ok" : "unavailable");

export async function serviceStates(): Promise<FounderHealth> {
  const [database, search, storage, smtp, inbox] = await Promise.all([
    first("SELECT 1").then((row) => row !== undefined, () => false),
    searchReachable(),
    storageReachable(),
    smtpReachable(),
    inboxReachable(),
  ]);
  return {
    database: state(database),
    search: state(search),
    storage: state(storage),
    mail: state(smtp && inbox),
    outbox_pending: database ? await pendingMail() : 0,
    search_sync_pending: database ? await pendingSearchSync() : 0,
  };
}

export async function healthReply(): Promise<{ status: number; body: { status: string } }> {
  if (!databaseReady()) return { status: 503, body: { status: "starting" } };
  const [search, storage] = await Promise.all([searchReachable(), storageReachable()]);
  return { status: 200, body: { status: search && storage ? "ok" : "unavailable" } };
}

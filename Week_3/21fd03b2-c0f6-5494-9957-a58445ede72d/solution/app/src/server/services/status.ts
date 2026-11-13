import { probeMail } from "./smtp";
import { s3 } from "./s3";
import { valkey } from "./valkey";

interface ServiceStatus {
  locks: "ok" | "down";
  storage: "ok" | "down";
  mail: "ok" | "down";
}

const state: ServiceStatus = { locks: "down", storage: "down", mail: "down" };
const PROBE_MS = 2000;

async function check(name: keyof ServiceStatus, probe: () => Promise<void>): Promise<void> {
  state[name] = await probe().then(
    () => "ok" as const,
    () => "down" as const,
  );
}

async function refreshStatus(): Promise<void> {
  await Promise.all([check("locks", () => valkey.ping()), check("storage", () => s3.ping()), check("mail", probeMail)]);
}

export function startStatusMonitor(): void {
  void refreshStatus();
  setInterval(() => void refreshStatus(), PROBE_MS).unref();
}

export const getStatus = (): ServiceStatus => ({ ...state });

/** A failed or successful real operation updates the cached state at once. */
export function noteService(name: keyof ServiceStatus, up: boolean): void {
  state[name] = up ? "ok" : "down";
}

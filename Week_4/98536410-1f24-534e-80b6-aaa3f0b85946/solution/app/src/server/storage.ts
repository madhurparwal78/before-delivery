// Tracks whether object storage answers: checked at boot and then every few seconds.
import { ensureBucket } from "./s3.js";
import { storageUnavailable } from "./errors.js";

const CHECK_EVERY_MS = 5000;

let up = false;
let lastFailure = "";
let checkedAt = new Date();

async function check(): Promise<void> {
  try {
    await ensureBucket();
    if (!up) console.log("object storage is reachable");
    up = true;
  } catch (error) {
    const reason = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : String(error);
    if (reason !== lastFailure) console.error("object storage is unreachable:", reason);
    lastFailure = reason;
    up = false;
  }
  checkedAt = new Date();
}

export function storageStatus(): { storage: "up" | "down"; checked_at: string } {
  return { storage: up ? "up" : "down", checked_at: checkedAt.toISOString() };
}

/** Called when a storage call fails mid-request: the status flips at once and storage is asked again straight away, so one slow answer does not hold the controls paused until the next scheduled check. */
export function reportStorageFailure(): void {
  up = false;
  checkedAt = new Date();
  void check();
}

export function requireStorage(): void {
  if (!up) throw storageUnavailable();
}

export async function startStorageMonitor(): Promise<void> {
  await Promise.race([check(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
}

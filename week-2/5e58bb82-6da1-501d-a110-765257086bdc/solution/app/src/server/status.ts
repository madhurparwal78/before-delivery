// Reachability of storage and mail, checked every five seconds (and at boot) for GET /api/status.
import { mailReachable } from "./smtp.js";
import { storageReachable } from "./s3.js";

export const status: { storage: "up" | "down"; mail: "up" | "down" } = { storage: "up", mail: "up" };

async function check(): Promise<void> {
  const [storage, mail] = await Promise.all([storageReachable(), mailReachable()]);
  status.storage = storage ? "up" : "down";
  status.mail = mail ? "up" : "down";
}

export function startStatusChecks(): void {
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    check().finally(() => {
      busy = false;
    });
  };
  run();
  setInterval(run, 5000);
}

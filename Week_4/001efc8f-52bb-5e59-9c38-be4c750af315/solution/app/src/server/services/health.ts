import { one, pool } from "../db.js";

// Reachability of storage and mail as last observed. A probe runs at least every 30 seconds
// (startHealthProbes); any real call may update the value sooner.
type Service = "storage" | "mail";
const reachable: Record<Service, boolean> = { storage: false, mail: false };

export function markService(service: Service, up: boolean): void {
  reachable[service] = up;
}

async function databaseUp(): Promise<boolean> {
  try {
    const row = await Promise.race([
      one<{ ok: number }>(pool, "SELECT 1 AS ok"),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2_000)),
    ]);
    return row?.ok === 1;
  } catch {
    return false;
  }
}

export async function healthBody(): Promise<{ status: "ok"; services: Record<"database" | Service, "up" | "down"> }> {
  const word = (up: boolean) => (up ? "up" : "down");
  return { status: "ok", services: { database: word(await databaseUp()), storage: word(reachable.storage), mail: word(reachable.mail) } };
}

export function startHealthProbes(probes: Record<Service, () => Promise<boolean>>): Promise<void> {
  const run = async () => {
    const [storage, mail] = await Promise.all([probes.storage(), probes.mail()]);
    reachable.storage = storage;
    reachable.mail = mail;
  };
  setInterval(() => void run(), 10_000).unref();
  return run();
}

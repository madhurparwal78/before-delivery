// Live service probes for /api/status and /api/studio/health, each result no older than 5 seconds.
import { contentReachable } from "./content.js";
import { pool } from "./db.js";
import { documentsReachable } from "./documents.js";
import { billingReachable } from "./killbill.js";
import { emailReachable } from "./mail.js";
import { pushReachable } from "./push.js";
import { queueReachable } from "./queue.js";
import { searchReachable } from "./search.js";
import { storageReachable } from "./storage.js";

type Service = "postgres" | "killbill" | "minio" | "mailpit" | "pocketbase" | "rabbitmq" | "gotenberg" | "meilisearch" | "ntfy";
type Health = Record<Service, "up" | "down">;

async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const PROBES: Record<Service, () => Promise<boolean>> = {
  postgres: postgresReachable,
  killbill: billingReachable,
  minio: storageReachable,
  mailpit: emailReachable,
  pocketbase: contentReachable,
  rabbitmq: queueReachable,
  gotenberg: documentsReachable,
  meilisearch: searchReachable,
  ntfy: pushReachable,
};

let cached: { at: number; health: Promise<Health> } | null = null;

export function health(): Promise<Health> {
  if (cached && Date.now() - cached.at < 4_000) return cached.health;
  const probing = (async () => {
    const entries = await Promise.all(
      (Object.keys(PROBES) as Service[]).map(async (name) => [name, (await PROBES[name]().catch(() => false)) ? "up" : "down"] as const),
    );
    return Object.fromEntries(entries) as Health;
  })();
  cached = { at: Date.now(), health: probing };
  return probing;
}

export async function clientStatus(): Promise<{ billing: string; storage: string; email: string; measuring: string; documents: string }> {
  const h = await health();
  return { billing: h.killbill, storage: h.minio, email: h.mailpit, measuring: h.rabbitmq, documents: h.gotenberg };
}

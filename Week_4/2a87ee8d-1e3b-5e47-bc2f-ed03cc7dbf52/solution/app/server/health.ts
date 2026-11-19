// Provider states for GET /api/health, each checked within the last 10 seconds.
import { config } from "./config.js";
import { healthy as killbillHealthy } from "./killbill.js";
import { healthy as storageHealthy } from "./storage.js";
import { healthy as mailHealthy } from "./smtp.js";
import { reply, type Reply } from "./http.js";

const state = { killbill: false, minio: false, mailpit: false };

async function check(): Promise<void> {
  const [killbill, minio, mailpit] = await Promise.all([killbillHealthy(), storageHealthy(), mailHealthy()]);
  Object.assign(state, { killbill, minio, mailpit });
}

export async function startHealth(): Promise<void> {
  await check();
  setInterval(() => void check(), 3000).unref();
}

export async function health(): Promise<Reply> {
  const up = (ok: boolean) => (ok ? "up" : "down");
  return reply(200, {
    status: "ok",
    instance: config.instanceId,
    db: "up",
    killbill: up(state.killbill),
    minio: up(state.minio),
    mailpit: up(state.mailpit),
  });
}

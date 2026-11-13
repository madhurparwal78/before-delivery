// Reachability of every service for GET /api/status and the outage banners.
// Each probe takes at most 3 seconds; results are reused for at most 5 seconds.
import net from "node:net";
import { SERVICE_NAMES, type ServiceName } from "../../shared/copy.js";
import { config } from "../config.js";
import { pool } from "../db.js";

const PROBE_MS = 3000;
const REUSE_MS = 5000;

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_MS), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

function smtpGreets(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const done = (up: boolean): void => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(PROBE_MS, () => done(false));
    socket.once("data", (chunk: Buffer) => done(chunk.toString().startsWith("220")));
    socket.once("error", () => done(false));
  });
}

async function postgresUp(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

const PROBES: Record<ServiceName, () => Promise<boolean>> = {
  postgres: postgresUp,
  keycloak: () => answers(`${config.keycloak.issuer}/.well-known/openid-configuration`),
  killbill: () => answers(`${config.killbill.url}/1.0/healthcheck`),
  mailpit: smtpGreets,
  minio: () => answers(`${config.s3.endpoint}/minio/health/live`),
  gotenberg: () => answers(`${config.gotenbergUrl}/health`),
  svix: () => answers(`${config.svix.url}/api/v1/health/`),
  ntfy: () => answers(`${config.ntfy.url}/v1/health`),
  renderProvider: () => answers(`${config.render.url}/`),
};

let cached: { at: number; services: Record<ServiceName, "up" | "down"> } | null = null;
let running: Promise<Record<ServiceName, "up" | "down">> | null = null;

async function probeAll(): Promise<Record<ServiceName, "up" | "down">> {
  const results = await Promise.all(SERVICE_NAMES.map(async (name) => [name, (await PROBES[name]()) ? "up" : "down"] as const));
  const services = Object.fromEntries(results) as Record<ServiceName, "up" | "down">;
  cached = { at: Date.now(), services };
  return services;
}

export async function serviceStatus(): Promise<Record<ServiceName, "up" | "down">> {
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.services;
  running ??= probeAll().finally(() => {
    running = null;
  });
  return running;
}

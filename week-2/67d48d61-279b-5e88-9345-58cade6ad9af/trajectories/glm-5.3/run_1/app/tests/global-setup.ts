import type { FullConfig } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import { openSync } from "node:fs";

let server: ReturnType<typeof spawn> | null = null;

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // stop the running copy, reset state, start a fresh seeded one
  try { execSync("node scripts/kill-servers.mjs") } catch { /* not running */ }
  execSync("node scripts/reset.mjs", { stdio: "inherit" });
  const out = openSync("/tmp/server.log", "a");
server = spawn("node", ["dist/server.js"], { stdio: ["ignore", out, out], detached: true });
server.unref();
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/server.pid", String(server.pid));
  await new Promise((resolve) => setTimeout(resolve, 6000));
}

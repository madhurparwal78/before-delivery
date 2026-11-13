import { pool } from "../db";
import { mailReachable } from "../mail";
import { storageReachable } from "../s3";
import { valkey } from "../valkey";

async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function valkeyReachable(): Promise<boolean> {
  try {
    return (await valkey.ping()) === "PONG";
  } catch {
    return false;
  }
}

/** `ok` when all four services answer; otherwise `unavailable` (never an error status). */
export async function healthStatus(): Promise<"ok" | "unavailable"> {
  const results = await Promise.all([postgresReachable(), valkeyReachable(), storageReachable(), mailReachable()]);
  return results.every(Boolean) ? "ok" : "unavailable";
}

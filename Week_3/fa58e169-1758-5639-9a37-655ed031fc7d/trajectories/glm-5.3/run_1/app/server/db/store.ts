import { env } from "../../common/env";
import { db } from "../../common/env";

export interface StoredChart {
  craft: "knit" | "crochet";
  mode: "flat" | "round";
  terms: "us" | "uk" | null;
  castOn: number;
  width: number;
  height: number;
  repeats: { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }[];
  cells: { row: number; col: number; stitch: string; colour: string; rev: number; repeat?: string; by?: string }[];
}

export interface PatternRecord {
  id: string;
  ownerId: string;
  name: string;
  craft: "knit" | "crochet";
  mode: "flat" | "round";
  terms: "us" | "uk" | null;
  castOn: number;
  width: number;
  height: number;
  chart: StoredChart;
  state: "draft" | "published";
  publishedVersion: number | null;
}

export interface ColourRecord {
  letter: string;
  name: string;
  hex: string;
}

import type { PoolClient } from "pg";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const crypto = require("node:crypto") as typeof import("node:crypto");

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

export function token(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString("hex");
  return candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export async function withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

export function expiryLabel(hours: number): string {
  return env.tz === "UTC" ? `${hours}h` : `${hours}h`;
}

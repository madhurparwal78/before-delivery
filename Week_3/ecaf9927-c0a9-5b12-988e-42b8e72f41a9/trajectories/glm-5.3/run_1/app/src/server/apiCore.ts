import type { IncomingMessage } from "node:http";
import { MM_PER_IN, parseTolerance, requestLength } from "../shared/units.js";
import type { Member } from "../shared/types.js";
import { unauthenticated } from "./errors.js";

/** Request body reading and the field parsing shared by all endpoints. */

export const SESSION_COOKIE = "kerfline_session";

export async function readBody(
  req: IncomingMessage
): Promise<{ raw: Buffer } | { tooLarge: true } | { badType: true }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > 1_000_000) return { tooLarge: true };
    chunks.push(chunk as Buffer);
  }
  return { raw: Buffer.concat(chunks) };
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> | null {
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function cookieOf(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export async function memberForSession(
  pool: import("pg").Pool,
  req: IncomingMessage
): Promise<Member | null> {
  const token = cookieOf(req);
  if (!token) return null;
  const result = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: "founder" | "engineer";
    units: "mm" | "in";
    precision: number;
  }>(
    `SELECT m.id, m.name, m.email, m.role, m.units, m.precision
     FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`,
    [token]
  );
  return result.rows[0] ?? null;
}

export function requireSession(member: Member | null): Member {
  if (!member) throw unauthenticated();
  return member;
}

export function lengthField(
  value: unknown,
  member: Member,
  kind: "length" | "coordinate"
): { value: number } | { error: string } {
  return requestLength(value as number | string | undefined, member.units, { kind });
}

export function angleField(value: unknown): { value: number } | { error: string } {
  if (typeof value === "number" && Number.isFinite(value)) return { value };
  return { error: "Enter an angle in degrees." };
}

export function toleranceField(
  value: unknown,
  member: Member
): { value: unknown } | { error: string } {
  const result = parseTolerance(value, member.units);
  if ("error" in result) return { error: result.error };
  return { value: result.value };
}

export const IN_TO_MM = MM_PER_IN;

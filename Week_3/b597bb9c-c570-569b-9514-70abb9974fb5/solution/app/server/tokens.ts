import { createHash, randomBytes } from "node:crypto";
import { codePoints } from "../shared/codepoints";
import { FIELD_ERRORS } from "../shared/copy";
import { NAME_MAX, RATE_LIMIT, RATE_WINDOW_SECONDS } from "../shared/limits";
import type { ReadToken } from "../shared/types";
import { one, query } from "./db";
import { AppError, invalid } from "./errors";
import { newId } from "./ids";
import { hub } from "./live";
import { kv } from "./kv";

const RATE_KEY_TTL_SECONDS = 20;
const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");
const windowOf = (nowMs: number): number => Math.floor(nowMs / 1000 / RATE_WINDOW_SECONDS);
const rateKey = (tokenId: string, window: number): string => `gatecut:rate:${tokenId}:${window}`;

export async function issueToken(raw: unknown): Promise<{ id: string; name: string; token: string; created_at: string }> {
  const name = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["name"] : undefined;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.other });
  const token = `gct_${randomBytes(20).toString("hex")}`;
  const row = await one<{ id: string; created_at: Date }>(
    "INSERT INTO tokens (id, name, token_hash) VALUES ($1,$2,$3) RETURNING id, created_at",
    [newId("t"), name.trim(), hashOf(token)],
  );
  return { id: row?.id ?? "", name: name.trim(), token, created_at: row?.created_at.toISOString() ?? "" };
}

export async function listTokens(): Promise<ReadToken[]> {
  const rows = await query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>("SELECT * FROM tokens ORDER BY created_at, id");
  const window = windowOf(Date.now());
  const endsIn = (window + 1) * RATE_WINDOW_SECONDS * 1000 - Date.now();
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at.toISOString(),
      last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
      window_requests: Number((await kv.get(rateKey(row.id, window))) ?? 0),
      window_ends_in_ms: endsIn,
    })),
  );
}

export async function revokeToken(id: string): Promise<boolean> {
  const gone = await one<{ id: string }>("DELETE FROM tokens WHERE id = $1 RETURNING id", [id]);
  return gone !== undefined;
}

/** Authenticates a bearer token and counts the request in its fixed ten-second window; over the limit is a 429. */
export async function authenticateToken(header: string | undefined): Promise<void> {
  const match = /^Bearer (gct_[0-9a-f]{40})$/.exec(header ?? "");
  const row = match ? await one<{ id: string }>("SELECT id FROM tokens WHERE token_hash = $1", [hashOf(match[1] ?? "")]) : undefined;
  if (!row) throw new AppError("unauthenticated");
  const now = Date.now();
  const window = windowOf(now);
  const key = rateKey(row.id, window);
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, RATE_KEY_TTL_SECONDS);
  const endsAt = (window + 1) * RATE_WINDOW_SECONDS * 1000;
  hub.toOwners({ type: "token_window", token_id: row.id, count, window_ends_in_ms: endsAt - now });
  void query("UPDATE tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  if (count > RATE_LIMIT) {
    const seconds = Math.max(1, Math.ceil((endsAt - now) / 1000));
    throw new AppError("rate_limited", { seconds }, {}, { "retry-after": String(seconds) });
  }
}

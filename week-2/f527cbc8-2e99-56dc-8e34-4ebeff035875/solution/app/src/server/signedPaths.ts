// Same-origin signed paths under /media/ for photos, thumbnails and ledger exports; a path signed for a vet link
// also names the link. Signing keys live only in Postgres: when the newest is at least
// PHOTO_URL_KEY_ROTATE_SECONDS old, the next one is created first, exactly once across instances (one row per
// generation). A path verifies with the key its `k` names until its own `exp`; a retired key is removed only once
// every path it signed has expired (brief: Photo URLs; Configuration and secrets).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import type { Queryable } from "./db.js";

/** What a path reads: a photo, its thumbnail, or a finished export's CSV. */
export type MediaKind = "photo" | "thumb" | "csv";

const SUFFIX: Record<MediaKind, string> = { photo: "", thumb: "/thumb", csv: "/csv" };

interface SigningKey {
  id: string;
  generation: number;
  secret: string;
  created_at: Date;
}

const signature = (secret: string, path: string, keyId: string, exp: number, vetLinkId: string | null): string =>
  createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(`${path}\n${keyId}\n${exp}\n${vetLinkId ?? ""}`)
    .digest("hex");

const pathOf = (kind: MediaKind, id: string): string => `/media/${encodeURIComponent(id)}${SUFFIX[kind]}`;

export interface SignedPath {
  url: string;
  expiresAt: number;
}

export type Signer = (kind: MediaKind, id: string, vetLinkId?: string | null) => SignedPath;

async function newestKey(client: Queryable): Promise<SigningKey | null> {
  const { rows } = await client.query<SigningKey>(`SELECT id, generation, secret, created_at FROM signing_keys ORDER BY generation DESC LIMIT 1`);
  return rows[0] ?? null;
}

/**
 * Signs paths for one response at instant `at`: rotates the ring first when the newest key is due, and records
 * how long the key's paths live so it is kept until the last of them expires.
 */
export async function signer(client: Queryable, at: number): Promise<Signer> {
  let key = await newestKey(client);
  if (!key || at - key.created_at.getTime() >= config.photoUrlKeyRotateSeconds * 1000) {
    await client.query(
      `INSERT INTO signing_keys (id, generation, secret, created_at, signs_until) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (generation) DO NOTHING`,
      [randomUUID(), (key?.generation ?? 0) + 1, randomBytes(32).toString("base64url"), new Date(at)],
    );
    key = await newestKey(client);
    if (!key) throw new Error("No photo signing key");
    await client.query(`DELETE FROM signing_keys WHERE generation < $1 AND signs_until <= $2`, [key.generation, new Date(at)]);
  }
  const exp = Math.floor(at / 1000) + config.photoUrlTtlSeconds;
  await client.query(`UPDATE signing_keys SET signs_until = $2 WHERE id = $1 AND signs_until < $2`, [key.id, new Date(exp * 1000)]);
  const signing = key;
  return (kind, id, vetLinkId = null) => {
    const path = pathOf(kind, id);
    const query = new URLSearchParams({ k: signing.id, exp: String(exp) });
    if (vetLinkId) query.set("v", vetLinkId);
    query.set("sig", signature(signing.secret, path, signing.id, exp, vetLinkId));
    return { url: `${path}?${query.toString()}`, expiresAt: exp * 1000 };
  };
}

/** The vet link a valid path was signed for (null for a staff or owner path), or `false` when it does not verify. */
export async function verifyPath(client: Queryable, kind: MediaKind, id: string, query: URLSearchParams, at: number): Promise<{ vetLinkId: string | null } | false> {
  const keyId = query.get("k") ?? "";
  const exp = query.get("exp") ?? "";
  const given = query.get("sig") ?? "";
  const vetLinkId = query.get("v");
  if (!/^\d{1,12}$/.test(exp) || Number(exp) * 1000 <= at || !/^[0-9a-f]{64}$/.test(given)) return false;
  const { rows } = await client.query<{ secret: string }>(`SELECT secret FROM signing_keys WHERE id = $1`, [keyId]);
  const key = rows[0];
  if (!key) return false;
  const expected = Buffer.from(signature(key.secret, pathOf(kind, id), keyId, Number(exp), vetLinkId), "hex");
  return timingSafeEqual(expected, Buffer.from(given, "hex")) ? { vetLinkId } : false;
}

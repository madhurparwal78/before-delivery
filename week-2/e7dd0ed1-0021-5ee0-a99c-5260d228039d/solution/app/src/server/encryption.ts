// Encryption at rest (brief: Business rules, Encryption at rest). Every version and every multipart
// upload has its own 256-bit data key; MinIO only ever holds AES-256-GCM ciphertext under it, and
// Postgres holds the data key only wrapped under the workspace key of one generation.
//
// Segment layout: the plaintext of each part (a single upload is one part) is cut into segments of
// SEGMENT bytes, the last one shorter; an empty part is one empty segment. Each segment is stored as
// nonce (12 bytes) ‖ ciphertext ‖ tag (16 bytes), so a completed multipart version is simply its
// parts' ciphertexts one after the other.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type pg from "pg";
import { config } from "./config.js";
import { pool, query, row, tx, type Db } from "./db.js";
import { authorize, membership } from "./access.js";
import { appendAudit } from "./audit.js";
import { ApiError, invalid } from "./errors.js";
import { fieldErrors, isoOrNull, readJson, sendJson, truncateToSecond, type Ctx } from "./http.js";

const SEGMENT = 65_536;
const NONCE = 12;
const TAG = 16;

export const newDataKey = (): Buffer => randomBytes(32);

function sealSegment(key: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function openSegment(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, NONCE));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([decipher.update(sealed.subarray(NONCE, sealed.length - TAG)), decipher.final()]);
}

// Encrypts one part's plaintext (or a whole single upload).
export function encryptPart(key: Buffer, plain: Buffer): Buffer {
  if (plain.length === 0) return sealSegment(key, plain);
  const out: Buffer[] = [];
  for (let offset = 0; offset < plain.length; offset += SEGMENT) out.push(sealSegment(key, plain.subarray(offset, offset + SEGMENT)));
  return Buffer.concat(out);
}

function* segmentSizes(partSizes: number[]): Generator<number> {
  for (const size of partSizes) {
    if (size === 0) yield 0;
    for (let left = size; left > 0; left -= SEGMENT) yield Math.min(SEGMENT, left);
  }
}

// Decrypts a stored object into its plaintext, segment by segment, given the plaintext part sizes.
export function decryptStream(source: AsyncIterable<Buffer>, key: Buffer, partSizes: number[]): Readable {
  async function* plain(): AsyncGenerator<Buffer> {
    const sizes = segmentSizes(partSizes);
    let pending: Buffer = Buffer.alloc(0);
    let next = sizes.next();
    for await (const chunk of source) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (!next.done && pending.length >= next.value + NONCE + TAG) {
        const length = next.value + NONCE + TAG;
        yield openSegment(key, pending.subarray(0, length));
        pending = pending.subarray(length);
        next = sizes.next();
      }
    }
    if (!next.done || pending.length) throw new Error("stored object does not match its segment layout");
  }
  return Readable.from(plain());
}

// The workspace key of generation g: HKDF-SHA256 over the server's secret key; never stored.
function workspaceKey(slug: string, generation: number): Buffer {
  return Buffer.from(hkdfSync("sha256", config.secretKey, "farshore-workspace-key", `${slug}:${generation}`, 32));
}

const wrap = (slug: string, generation: number, dataKey: Buffer): Buffer => sealSegment(workspaceKey(slug, generation), dataKey);
const unwrap = (slug: string, generation: number, wrapped: Buffer): Buffer => openSegment(workspaceKey(slug, generation), wrapped);

export interface WrappedKey {
  wrapped_key: Buffer;
  key_generation: number;
}

// Wraps a data key under the workspace's current generation. The share lock on the workspace row
// orders this write against a rotation's generation bump, so no key is left on an old generation.
export async function wrapForWorkspace(client: pg.PoolClient, workspaceId: string, dataKey: Buffer): Promise<WrappedKey> {
  const ws = await row<{ slug: string; key_generation: number }>(client,
    "SELECT slug, key_generation FROM workspaces WHERE id = $1 FOR SHARE", [workspaceId]);
  return { wrapped_key: wrap(ws.slug, ws.key_generation, dataKey), key_generation: ws.key_generation };
}

const slugs = new Map<string, string>();

export async function unwrapForWorkspace(db: Db, workspaceId: string, key: WrappedKey): Promise<Buffer> {
  let slug = slugs.get(workspaceId);
  if (slug === undefined) {
    slug = (await row<{ slug: string }>(db, "SELECT slug FROM workspaces WHERE id = $1", [workspaceId])).slug;
    slugs.set(workspaceId, slug);
  }
  return unwrap(slug, key.key_generation, key.wrapped_key);
}

// Workspace key rotation g → g+1: bump the generation (taking the row lock that every wrap shares),
// then re-wrap every stored version's and open upload's data key still on an older generation.
// Only Postgres changes; no MinIO object is rewritten.
async function rotateWorkspaceKey(workspaceId: string, actor: string, at: Date): Promise<{ generation: number; rewrapped: number }> {
  // One rotation per workspace at a time: a session-level advisory lock, released even if this
  // process dies mid-rotation.
  const holder = await pool.connect();
  try {
    const locked = await row<{ ok: boolean }>(holder, "SELECT pg_try_advisory_lock(hashtextextended($1, 13)) AS ok", [`rotate:${workspaceId}`]);
    if (!locked.ok) throw new ApiError("rotation_in_progress");
    try {
      return await rewrapAll(workspaceId, actor, at);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtextextended($1, 13))", [`rotate:${workspaceId}`]);
    }
  } finally {
    holder.release();
  }
}

async function rewrapAll(workspaceId: string, actor: string, at: Date): Promise<{ generation: number; rewrapped: number }> {
  const { slug, key_generation: generation } = await tx(async (client) => {
    const bumped = await row<{ slug: string; key_generation: number }>(client,
      "UPDATE workspaces SET key_generation = key_generation + 1, key_rotated_at = $2 WHERE id = $1 RETURNING slug, key_generation",
      [workspaceId, truncateToSecond(at)]);
    await appendAudit(client, bumped.slug,
      { actor, action: "encryption.rotated", target: bumped.slug, detail: `generation ${bumped.key_generation}` }, at);
    return bumped;
  });
  let rewrapped = 0;
  for (const table of ["versions", "uploads"] as const) {
    const id = table === "versions" ? "version_id" : "upload_id";
    for (;;) {
      const moved = await tx(async (client) => {
        const stale = await query<WrappedKey & { id: string }>(client,
          `SELECT t.${id} AS id, t.wrapped_key, t.key_generation FROM ${table} t
           ${table === "versions" ? "JOIN buckets b ON b.id = t.bucket_id WHERE b.workspace_id = $1"
             : "WHERE t.workspace_id = $1 AND t.state = 'open'"} AND t.key_generation < $2
           ORDER BY t.${id} LIMIT 500 FOR UPDATE OF t`, [workspaceId, generation]);
        for (const item of stale) {
          await client.query(`UPDATE ${table} SET wrapped_key = $2, key_generation = $3 WHERE ${id} = $1`,
            [item.id, wrap(slug, generation, unwrap(slug, item.key_generation, item.wrapped_key)), generation]);
        }
        return stale.length;
      });
      rewrapped += moved;
      if (moved === 0) break;
    }
  }
  return { generation, rewrapped };
}

export async function encryptionStatus(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const ws = await row<{ key_generation: number; key_rotated_at: Date | null }>(pool,
    "SELECT key_generation, key_rotated_at FROM workspaces WHERE id = $1", [m.workspace.id]);
  const counts = await query<{ generation: number; n: number }>(pool,
    `SELECT key_generation AS generation, count(*)::int AS n FROM (
       SELECT v.key_generation FROM versions v JOIN buckets b ON b.id = v.bucket_id WHERE b.workspace_id = $1
       UNION ALL SELECT key_generation FROM uploads WHERE workspace_id = $1 AND state = 'open') k
     GROUP BY key_generation ORDER BY key_generation`, [m.workspace.id]);
  sendJson(ctx, 200, {
    generation: ws.key_generation, rotated_at: isoOrNull(ws.key_rotated_at),
    wrapped: Object.fromEntries(counts.map((c) => [String(c.generation), c.n])),
  });
}

export async function rotateEncryption(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer", false, true);
  const extra = fieldErrors(await readJson(ctx), [], []);
  if (Object.keys(extra).length) throw invalid(extra);
  sendJson(ctx, 200, await rotateWorkspaceKey(m.workspace.id, m.user.email, ctx.now));
}

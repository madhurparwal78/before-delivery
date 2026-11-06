// Vaults, invites and the revision log (API: "Vaults" and "Revisions").
import { createHash, randomUUID } from "node:crypto";
import { requireSync } from "../billing.ts";
import { config } from "../config.ts";
import { pool, transaction, type Queryable } from "../db.ts";
import { ApiError, errorBody, jsonBody, notFound, PUSH_LIMIT, route, sendJson, UUID, validationError, type Ctx } from "../http.ts";
import { keyProblem, remember, repeatScope, replayed, type RepeatScope } from "../idempotency.ts";
import { enqueue, inviteEmail, sendSoon } from "../mail.ts";
import { newToken, tokenHash } from "../passwords.ts";
import { getObject, putObject } from "../s3.ts";
import { requireApproved, requireSession, type Session } from "../session.ts";
import { emailProblem } from "./accounts.ts";
import type { CairnAccountRef } from "../killbill.ts";
import { isoSeconds } from "../../shared/time.ts";
import type { KeyEnvelope, Revision, Vault, VaultRole } from "../../shared/types.ts";

interface VaultRow {
  id: string;
  name: string;
  owner_id: string;
  key_envelope: KeyEnvelope;
  head: number;
  created_at: Date;
  role: VaultRole;
}

function vaultJson(row: VaultRow): Vault {
  return { id: row.id, name: row.name, role: row.role, created_at: isoSeconds(row.created_at) };
}

/** The caller's vault; any vault they do not belong to answers 404 like a missing one. */
async function memberVault(session: Session, vaultId: string, db: Queryable = pool): Promise<VaultRow> {
  if (!UUID.test(vaultId)) throw notFound();
  const { rows } = await db.query<VaultRow>(
    `SELECT v.id, v.name, v.owner_id, v.key_envelope, v.head, v.created_at, m.role
     FROM vaults v JOIN vault_members m ON m.vault_id = v.id AND m.account_id = $2 WHERE v.id = $1`, [vaultId, session.account.id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const blobKey = (vaultId: string, noteId: string, rev: number) => `vault-blobs/${vaultId}/${noteId}/${rev}.bin`;
const MIN_ENVELOPE = 32;
const MAX_ENVELOPE = 2_000_000;

const REVISION_COLUMNS = `r.rev, r.note_id, r.base_revision, r.ciphertext_sha256, r.byte_length, r.device_id, d.name AS device_name,
  r.created_at, r.restored_from`;

interface RevisionRow extends Omit<Revision, "created_at"> {
  created_at: Date;
}

function revisionJson(row: RevisionRow): Revision {
  return { ...row, created_at: isoSeconds(row.created_at) };
}

const isPositiveInt = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

function validEnvelope(value: unknown): value is KeyEnvelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return [e.salt, e.iv, e.wrapped_key].every((v) => typeof v === "string" && v.length > 0 && BASE64.test(v))
    && Number.isInteger(e.iterations) && (e.iterations as number) > 0;
}

route("POST", "/api/vaults", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  requireApproved(session);
  await requireSync(session.account, "create_vault");
  const body = jsonBody(ctx);
  const fields: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) fields.name = "Name the vault in 1 to 80 characters.";
  if (!validEnvelope(body.key_envelope)) fields.key_envelope = "Send salt, iv and wrapped_key in base64 and a whole-number iterations.";
  if (Object.keys(fields).length) throw validationError(fields);
  const envelope = body.key_envelope as KeyEnvelope;
  const vault = await transaction(async (db) => {
    const id = randomUUID();
    const { rows } = await db.query<VaultRow>(
      `INSERT INTO vaults (id, name, owner_id, key_envelope) VALUES ($1, $2, $3, $4)
       RETURNING id, name, owner_id, key_envelope, head, created_at, 'owner' AS role`,
      [id, name, session.account.id, { salt: envelope.salt, iterations: envelope.iterations, iv: envelope.iv, wrapped_key: envelope.wrapped_key }]);
    await db.query("INSERT INTO vault_members (vault_id, account_id, role) VALUES ($1, $2, 'owner')", [id, session.account.id]);
    return rows[0];
  });
  sendJson(ctx.res, 201, { vault: vaultJson(vault) });
});

route("GET", "/api/vaults", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const { rows } = await pool.query<VaultRow>(
    `SELECT v.id, v.name, v.owner_id, v.key_envelope, v.head, v.created_at, m.role FROM vaults v
     JOIN vault_members m ON m.vault_id = v.id WHERE m.account_id = $1 ORDER BY v.created_at, v.id`, [session.account.id]);
  sendJson(ctx.res, 200, { vaults: rows.map(vaultJson) });
});

route("GET", "/api/vaults/:vault", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  requireApproved(session);
  const members = await pool.query<{ display_name: string; role: VaultRole }>(
    `SELECT a.display_name, m.role FROM vault_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.vault_id = $1 ORDER BY m.role DESC, m.joined_at`, [vault.id]);
  sendJson(ctx.res, 200, { vault: vaultJson(vault), key_envelope: vault.key_envelope, members: members.rows, head: vault.head || null });
});

route("POST", "/api/vaults/:vault/invites", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  if (vault.role !== "owner") throw new ApiError(403, "not_vault_owner", "Only the vault owner can invite a partner.");
  const body = jsonBody(ctx);
  const problem = emailProblem(body.email);
  if (problem) throw validationError({ email: problem });
  const email = body.email as string;
  const token = newToken();
  const invite = await transaction(async (db) => {
    const createdAt = new Date();
    const id = randomUUID();
    await db.query("INSERT INTO invites (id, token_hash, vault_id, email, inviter_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, tokenHash(token), vault.id, email, session.account.id, createdAt]);
    const expiresAt = new Date(createdAt.getTime() + config.timers.inviteTtl * 1000);
    await enqueue(db, inviteEmail(email, session.account.display_name, expiresAt, session.account.time_zone, token));
    return { id, email, expires_at: isoSeconds(expiresAt) };
  });
  sendSoon();
  sendJson(ctx.res, 201, { invite });
});

route("POST", "/api/invites/:token/accept", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await transaction(async (db) => {
    const { rows } = await db.query<{ id: string; vault_id: string; email: string; created_at: Date; used_at: Date | null }>(
      "SELECT id, vault_id, email, created_at, used_at FROM invites WHERE token_hash = $1 FOR UPDATE", [tokenHash(ctx.params.token)]);
    const invite = rows[0];
    if (!invite) throw notFound();
    if (invite.email.toLowerCase() !== session.account.email.toLowerCase()) {
      throw new ApiError(403, "invite_email_mismatch", "This invite was sent to a different email address.");
    }
    if (invite.used_at) throw new ApiError(409, "link_used", "This invite has already been used.");
    if (Date.now() >= invite.created_at.getTime() + config.timers.inviteTtl * 1000) {
      throw new ApiError(410, "link_expired", "This invite has expired.");
    }
    await db.query("UPDATE invites SET used_at = now() WHERE id = $1", [invite.id]);
    await db.query("INSERT INTO vault_members (vault_id, account_id, role) VALUES ($1, $2, 'partner') ON CONFLICT DO NOTHING",
      [invite.vault_id, session.account.id]);
    return memberVault(session, invite.vault_id, db);
  });
  sendJson(ctx.res, 200, { vault: vaultJson(vault) });
});

/** Pushes and restores follow the vault owner's Sync state. */
async function requireWritable(vault: VaultRow): Promise<void> {
  const owner = await pool.query<CairnAccountRef>("SELECT id, email, display_name, time_zone FROM accounts WHERE id = $1", [vault.owner_id]);
  await requireSync(owner.rows[0], "write");
}

function conflict(head: number | null): ApiError {
  return new ApiError(409, "revision_conflict", "Another device recorded a newer revision of this note first.", { head_revision: head });
}

async function noteHead(db: Queryable, vaultId: string, noteId: string): Promise<number | null> {
  const { rows } = await db.query<{ head: number | null }>("SELECT max(rev) AS head FROM revisions WHERE vault_id = $1 AND note_id = $2", [vaultId, noteId]);
  return rows[0].head;
}

interface Recorded {
  revision: Revision;
  cursor: number;
}

/** Records the vault's next revision while holding the vault row, writing its blob first. */
async function record(db: Queryable, session: Session, vault: VaultRow, noteId: string, base: number | null,
  blob: Buffer, restoredFrom: number | null, scope: RepeatScope): Promise<Recorded> {
  const rev = vault.head + 1;
  await putObject(blobKey(vault.id, noteId, rev), blob, "application/octet-stream");
  const sha = createHash("sha256").update(blob).digest("hex");
  const inserted = await db.query<RevisionRow>(
    `INSERT INTO revisions (vault_id, rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, restored_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING rev, note_id, base_revision, ciphertext_sha256, byte_length, device_id, $9::text AS device_name, created_at, restored_from`,
    [vault.id, rev, noteId, base, sha, blob.length, session.device.id, restoredFrom, session.device.name]);
  await db.query("UPDATE vaults SET head = $2 WHERE id = $1", [vault.id, rev]);
  const cursor = await advanceCursor(db, session.device.id, vault.id, rev);
  const result = { revision: revisionJson(inserted.rows[0]), cursor };
  await remember(db, scope, 201, result);
  return result;
}

async function advanceCursor(db: Queryable, deviceId: string, vaultId: string, rev: number): Promise<number> {
  const { rows } = await db.query<{ cursor: number }>(
    `INSERT INTO cursors (device_id, vault_id, cursor) VALUES ($1, $2, $3)
     ON CONFLICT (device_id, vault_id) DO UPDATE SET cursor = GREATEST(cursors.cursor, EXCLUDED.cursor) RETURNING cursor`,
    [deviceId, vaultId, rev]);
  return rows[0].cursor;
}

/** The shared shape of push and restore: replay, approval, entitlement, then the locked write. */
async function writeRevision(ctx: Ctx, vaultId: string, noteId: string,
  write: (db: Queryable, session: Session, vault: VaultRow, scope: RepeatScope) => Promise<Recorded | null>,
  preflight: (session: Session, vault: VaultRow) => Promise<void> = async () => undefined): Promise<void> {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, vaultId);
  if (!UUID.test(noteId)) throw notFound();
  await preflight(session, vault);
  const scope = repeatScope(ctx, session.device.id);
  if (scope && await replayed(pool, ctx, scope)) return;
  try {
    requireApproved(session);
    await requireWritable(vault);
    if (!scope) throw validationError({ "Idempotency-Key": keyProblem });
    const result = await transaction(async (db) => {
      const locked = await db.query<VaultRow>("SELECT id, name, owner_id, key_envelope, head, created_at FROM vaults WHERE id = $1 FOR UPDATE", [vault.id]);
      if (await replayed(db, ctx, scope)) return null;
      return write(db, session, { ...locked.rows[0], role: vault.role }, scope);
    });
    if (result) sendJson(ctx.res, 201, result);
  } catch (error) {
    if (scope && error instanceof ApiError && error.status < 500) await remember(pool, scope, error.status, errorBody(error));
    throw error;
  }
}

function decodeBase64(text: unknown): Buffer | null {
  return typeof text === "string" && BASE64.test(text) ? Buffer.from(text, "base64") : null;
}

route("POST", "/api/vaults/:vault/notes/:note/revisions", async (ctx: Ctx) => {
  await writeRevision(ctx, ctx.params.vault, ctx.params.note, async (db, session, vault, scope) => {
    const body = jsonBody(ctx);
    const baseValid = body.base_revision === null || isPositiveInt(body.base_revision);
    const head = await noteHead(db, vault.id, ctx.params.note);
    if (baseValid && body.base_revision !== head) throw conflict(head);
    const fields: Record<string, string> = {};
    if (!baseValid) fields.base_revision = "Send the note's current head revision, or null for its first push.";
    const blob = decodeBase64(body.ciphertext);
    if (!blob || blob.length < MIN_ENVELOPE || blob.length > MAX_ENVELOPE || blob.subarray(0, 4).toString("latin1") !== "CRN1") {
      fields.ciphertext = "Send a base64 CRN1 encrypted envelope of 32 to 2,000,000 bytes.";
    } else if (body.ciphertext_sha256 !== createHash("sha256").update(blob).digest("hex")) {
      fields.ciphertext_sha256 = "Does not match the SHA-256 of the decoded ciphertext bytes.";
    }
    if (Object.keys(fields).length) throw validationError(fields);
    return record(db, session, vault, ctx.params.note, head, blob as Buffer, null, scope);
  });
}, PUSH_LIMIT);

route("POST", "/api/vaults/:vault/notes/:note/restore", async (ctx: Ctx) => {
  let chosen: number | null = null;
  await writeRevision(ctx, ctx.params.vault, ctx.params.note, async (db, session, vault, scope) => {
    const body = jsonBody(ctx);
    const head = await noteHead(db, vault.id, ctx.params.note);
    if (isPositiveInt(body.base_revision) && body.base_revision !== head) throw conflict(head);
    const fields: Record<string, string> = {};
    if (chosen === null) fields.revision = "Choose a revision of this note.";
    if (!isPositiveInt(body.base_revision)) fields.base_revision = "Send the note's current head revision.";
    if (Object.keys(fields).length) throw validationError(fields);
    const blob = await getObject(blobKey(vault.id, ctx.params.note, chosen as number));
    if (!blob) throw notFound();
    return record(db, session, vault, ctx.params.note, head, blob, chosen, scope);
  }, async (_session, vault) => {
    const body = jsonBody(ctx);
    if (!isPositiveInt(body.revision)) return;
    const found = await pool.query("SELECT 1 FROM revisions WHERE vault_id = $1 AND note_id = $2 AND rev = $3", [vault.id, ctx.params.note, body.revision]);
    if (!found.rowCount) throw notFound();
    chosen = body.revision;
  });
});

route("GET", "/api/vaults/:vault/revisions", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  requireApproved(session);
  const after = Number(ctx.url.searchParams.get("after") ?? 0);
  const limit = Number(ctx.url.searchParams.get("limit") ?? 100);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(after) || after < 0) fields.after = "Use a whole number of 0 or more.";
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fields.limit = "Use a whole number from 1 to 500.";
  if (Object.keys(fields).length) throw validationError(fields);
  const { rows } = await pool.query<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM revisions r JOIN devices d ON d.id = r.device_id
     WHERE r.vault_id = $1 AND r.rev > $2 ORDER BY r.rev LIMIT $3`, [vault.id, after, limit]);
  const nextAfter = rows.length ? rows[rows.length - 1].rev : after;
  const cursor = rows.length
    ? await advanceCursor(pool, session.device.id, vault.id, nextAfter)
    : await currentCursor(session.device.id, vault.id);
  sendJson(ctx.res, 200, { revisions: rows.map(revisionJson), next_after: nextAfter, cursor });
});

async function currentCursor(deviceId: string, vaultId: string): Promise<number> {
  const { rows } = await pool.query<{ cursor: number }>("SELECT cursor FROM cursors WHERE device_id = $1 AND vault_id = $2", [deviceId, vaultId]);
  return rows[0]?.cursor ?? 0;
}

route("GET", "/api/vaults/:vault/revisions/:rev/blob", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  requireApproved(session);
  const rev = Number(ctx.params.rev);
  const { rows } = await pool.query<{ note_id: string }>("SELECT note_id FROM revisions WHERE vault_id = $1 AND rev = $2",
    [vault.id, Number.isInteger(rev) ? rev : -1]);
  if (!rows[0]) throw notFound();
  const blob = await getObject(blobKey(vault.id, rows[0].note_id, rev));
  if (!blob) throw notFound();
  ctx.res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": blob.length, "Cache-Control": "no-store" });
  ctx.res.end(blob);
});

route("GET", "/api/vaults/:vault/notes/:note/history", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  requireApproved(session);
  if (!UUID.test(ctx.params.note)) throw notFound();
  const { rows } = await pool.query<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM revisions r JOIN devices d ON d.id = r.device_id
     WHERE r.vault_id = $1 AND r.note_id = $2 ORDER BY r.rev DESC`, [vault.id, ctx.params.note]);
  sendJson(ctx.res, 200, { note_id: ctx.params.note, revisions: rows.map(revisionJson) });
});

route("GET", "/api/vaults/:vault/cursor", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const vault = await memberVault(session, ctx.params.vault);
  requireApproved(session);
  sendJson(ctx.res, 200, { device_id: session.device.id, cursor: await currentCursor(session.device.id, vault.id) });
});

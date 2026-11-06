// The hash-chained audit trail (brief: Business rules, Audit trail and Audit CSV; API, Encryption and
// audit). Every entry is appended here, one at a time per workspace, in the change that causes it.
import { createHash } from "node:crypto";
import { authorize, membership } from "./access.js";
import pg from "pg";
import { one, pool, query, tx, type Db } from "./db.js";
import { invalid } from "./errors.js";
import { isoSecond, send, sendJson, truncateToSecond, type Ctx } from "./http.js";
import { characters } from "./limits.js";
import { AUDIT_ACTIONS } from "../shared/auditActions.js";

type AuditAction = (typeof AUDIT_ACTIONS)[number];

const GENESIS = "0".repeat(64);
const PAGE = 50;

interface AuditEntry {
  seq: number;
  at: Date;
  actor: string;
  action: string;
  target: string;
  detail: string;
  prev_hash: string;
  hash: string;
}

// SHA-256 over the seven canonical lines joined by line feeds.
function entryHash(seq: number, at: Date, actor: string, action: string, target: string, detail: string, prevHash: string): string {
  return createHash("sha256").update([String(seq), isoSecond(at), actor, action, target, detail, prevHash].join("\n"), "utf8").digest("hex");
}

interface AuditRecord {
  actor: string;
  action: AuditAction;
  target: string;
  detail: string;
}

// Appends one entry to a workspace's trail. Appends of one workspace are serialised by a
// transaction-scoped lock, so the sequence never repeats or skips.
export async function appendAudit(db: Db, workspaceSlug: string, record: AuditRecord, at: Date = new Date()): Promise<void> {
  if (db instanceof pg.Pool) {
    await tx((client) => appendAudit(client, workspaceSlug, record, at));
    return;
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 11))", [`audit:${workspaceSlug}`]);
  const last = await one<{ seq: number; hash: string }>(db,
    "SELECT seq, hash FROM audit_entries WHERE workspace_slug = $1 ORDER BY seq DESC LIMIT 1", [workspaceSlug]);
  const seq = (last?.seq ?? 0) + 1;
  const second = truncateToSecond(at);
  const prevHash = last?.hash ?? GENESIS;
  await db.query(
    `INSERT INTO audit_entries (workspace_slug, seq, at, actor, action, target, detail, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [workspaceSlug, seq, second, record.actor, record.action, record.target, record.detail, prevHash,
      entryHash(seq, second, record.actor, record.action, record.target, record.detail, prevHash)]);
}

// Account actions (sign-in, password, two-step) go to every workspace the user belongs to right now.
export async function appendAuditForUser(db: Db, userId: string, record: AuditRecord, at: Date = new Date()): Promise<void> {
  const slugs = await query<{ slug: string }>(db,
    "SELECT w.slug FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY w.slug", [userId]);
  for (const { slug } of slugs) await appendAudit(db, slug, record, at);
}

// A permission refusal names the object key, else the bucket, else the request path.
export function deniedRecord(actor: string, method: string, rawPath: string, key: string | null, bucket: string | null): AuditRecord {
  return { actor, action: "permission.denied", target: key || bucket || rawPath, detail: `${method} ${rawPath}` };
}

// Verify reads the stored rows in seq order and names the first edited, rewritten or missing entry.
async function verifyChain(db: Db, workspaceSlug: string): Promise<{ ok: boolean; entries: number; first_broken_seq: number | null }> {
  const rows = await query<AuditEntry>(db, "SELECT * FROM audit_entries WHERE workspace_slug = $1 ORDER BY seq", [workspaceSlug]);
  let broken: number | null = null;
  let expectedSeq = 1;
  let prev = GENESIS;
  for (const entry of rows) {
    if (entry.seq !== expectedSeq) {
      broken = expectedSeq;
      break;
    }
    const recomputed = entryHash(entry.seq, entry.at, entry.actor, entry.action, entry.target, entry.detail, entry.prev_hash);
    if (entry.prev_hash !== prev || entry.hash !== recomputed) {
      broken = entry.seq;
      break;
    }
    prev = entry.hash;
    expectedSeq += 1;
  }
  return { ok: broken === null, entries: rows.length, first_broken_seq: broken };
}

// CSV neutralisation and RFC 4180 quoting, decided once.
function csvField(value: string): string {
  const neutral = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutral) ? `"${neutral.replace(/"/g, '""')}"` : neutral;
}

interface Filters {
  action: string | null;
  actor: string | null;
}

function readFilters(ctx: Ctx): Filters {
  const action = ctx.query.get("action") || null;
  const actor = ctx.query.get("actor") || null;
  const errors: Record<string, string> = {};
  if (action !== null && !(AUDIT_ACTIONS as readonly string[]).includes(action)) errors.action = "Choose an action from the list.";
  if (actor !== null && characters(actor) > 320) errors.actor = "Actors are 1 to 320 characters.";
  const cursor = ctx.query.get("cursor");
  if (cursor && !/^[1-9]\d{0,15}$/.test(cursor)) errors.cursor = "This page link is no longer valid.";
  if (Object.keys(errors).length) throw invalid(errors);
  return { action, actor };
}

function filterSql(filters: Filters, values: unknown[]): string {
  let sql = "";
  if (filters.action !== null) {
    values.push(filters.action);
    sql += ` AND action = $${values.length}`;
  }
  if (filters.actor !== null) {
    values.push(filters.actor);
    sql += ` AND actor = $${values.length}`;
  }
  return sql;
}

const auditEntryJson = (e: AuditEntry): Record<string, unknown> => ({
  seq: e.seq, at: isoSecond(e.at), actor: e.actor, action: e.action, target: e.target, detail: e.detail, hash: e.hash,
});

export async function listAudit(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const filters = readFilters(ctx);
  const values: unknown[] = [m.workspace.slug];
  let sql = `SELECT * FROM audit_entries WHERE workspace_slug = $1${filterSql(filters, values)}`;
  const cursor = ctx.query.get("cursor");
  if (cursor) {
    values.push(Number(cursor));
    sql += ` AND seq < $${values.length}`;
  }
  const rows = await query<AuditEntry>(pool, `${sql} ORDER BY seq DESC LIMIT ${PAGE + 1}`, values);
  const page = rows.slice(0, PAGE);
  sendJson(ctx, 200, {
    entries: page.map(auditEntryJson),
    next_cursor: rows.length > PAGE ? String(page[page.length - 1]?.seq) : null,
  });
}

export async function exportAudit(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  const filters = readFilters(ctx);
  const values: unknown[] = [m.workspace.slug];
  const rows = await query<AuditEntry>(pool,
    `SELECT * FROM audit_entries WHERE workspace_slug = $1${filterSql(filters, values)} ORDER BY seq`, values);
  const lines = ["seq,at_utc,actor,action,target,detail,prev_hash,hash", ...rows.map((e) =>
    [String(e.seq), isoSecond(e.at), e.actor, e.action, e.target, e.detail, e.prev_hash, e.hash].map(csvField).join(","))];
  send(ctx, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="farshore-${m.workspace.slug}-audit.csv"`,
    "Cache-Control": "private, no-store",
  }, `${lines.join("\n")}\n`);
}

export async function verifyAudit(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "administer");
  sendJson(ctx, 200, await verifyChain(pool, m.workspace.slug));
}

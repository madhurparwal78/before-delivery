// The append-only audit trail: one event per write request, in the same commit as its effect when it has one.
import { AsyncLocalStorage } from "node:async_hooks";
import { one, pool, rows, type Db } from "./db.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields, isUuid } from "./validate.ts";
import { isoInstant } from "../shared/time.ts";
import type { Role } from "../shared/api.ts";

type AuditOutcome =
  | "allowed"
  | "refused_session"
  | "refused_csrf"
  | "refused_rate"
  | "refused_role"
  | "refused_scope"
  | "refused_validation"
  | "refused_conflict"
  | "failed_dependency";

type TargetType = "booking" | "series" | "purchase" | "document" | "visit" | "inspector_link" | "rate" | "truck" | "site" | "session";

interface AuditActor {
  userId: string;
  name: string;
  role: Role;
}

export interface AuditDraft {
  method: string;
  /** The endpoint table's path pattern; null when the path matches none. */
  pattern: string | null;
  params: Record<string, string>;
  actor: AuditActor | null;
  /** The user the event belongs to for scope: the caller, the refused session's owner or the refused sign-in's user. */
  subjectUserId: string | null;
  signInEmail: string | null;
  tokenTenantId: string | null;
  tokenSiteId: string | null;
  addressPrefix: string | null;
  written: boolean;
}

const drafts = new AsyncLocalStorage<AuditDraft>();

export function withAuditDraft<T>(draft: AuditDraft | null, work: () => Promise<T>): Promise<T> {
  return draft ? drafts.run(draft, work) : work();
}

export function currentDraft(): AuditDraft | undefined {
  return drafts.getStore();
}

/** The audit outcome for an answer: the one place a status becomes an outcome. */
function outcomeFor(status: number, code: string | null): AuditOutcome {
  if (status < 300) return "allowed";
  if (status === 401) return "refused_session";
  if (status === 403) return code === "forbidden" ? "refused_role" : "refused_csrf";
  if (status === 429) return "refused_rate";
  if (status === 405) return "refused_role";
  if (status === 404 || status === 410) return "refused_scope";
  if (status === 413 || status === 415 || status === 422) return "refused_validation";
  if (status === 409) return "refused_conflict";
  return "failed_dependency";
}

/** On a success that creates a record, the record's type and where its id sits in the response. */
const CREATED: Record<string, [TargetType, string]> = {
  "POST /api/bookings": ["booking", "booking"],
  "POST /api/recurring-series": ["series", "series"],
  "POST /api/pack-purchases": ["purchase", "purchase"],
  "POST /api/documents": ["document", "document"],
  "POST /api/trucks/{truck_id}/visits": ["visit", "visit"],
  "POST /api/trucks/{truck_id}/inspector-links": ["inspector_link", "link"],
  "POST /api/inspector-links/{id}/reissue": ["inspector_link", "link"],
  "POST /api/sites/{site_id}/rates": ["rate", "rate"],
};

const PATH_TARGET: [RegExp, TargetType][] = [
  [/^\/api\/bookings\/\{id\}/, "booking"],
  [/^\/api\/documents\/\{id\}/, "document"],
  [/^\/api\/trucks\/\{truck_id\}/, "truck"],
  [/^\/api\/visits\/\{id\}/, "visit"],
  [/^\/api\/inspector-links\/\{id\}/, "inspector_link"],
  [/^\/api\/sites\/\{site_id\}/, "site"],
];

function createdId(body: unknown, key: string): string | null {
  const parsed: unknown = typeof body === "string" ? JSON.parse(body) : body;
  if (parsed === null || typeof parsed !== "object") return null;
  const record = (parsed as Record<string, unknown>)[key];
  if (record === null || typeof record !== "object") return null;
  const id = (record as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function targetOf(draft: AuditDraft, status: number, body: unknown): { type: TargetType | null; id: string | null } {
  const { pattern } = draft;
  if (pattern === null) return { type: null, id: null };
  if (pattern === "/api/session") return { type: "session", id: null };
  if (pattern.startsWith("/api/inspect/")) return { type: "inspector_link", id: null };
  const created = CREATED[`${draft.method} ${pattern}`];
  if (created && status < 300) return { type: created[0], id: createdId(body, created[1]) };
  const fromPath = PATH_TARGET.find(([re]) => re.test(pattern));
  if (!fromPath) return { type: null, id: null };
  const value = draft.params.id ?? draft.params.truck_id ?? draft.params.site_id;
  return { type: fromPath[1], id: isUuid(value) ? value : null };
}

async function write(db: Db | typeof pool, draft: AuditDraft, status: number, code: string | null, body: unknown): Promise<void> {
  const subject =
    draft.subjectUserId === null && draft.signInEmail !== null
      ? (await one<{ id: string }>(db, "SELECT id FROM users WHERE lower(email) = lower($1)", [draft.signInEmail]))?.id ?? null
      : draft.subjectUserId;
  const owner = subject === null ? undefined : await one<{ tenant_id: string }>(db, "SELECT tenant_id FROM users WHERE id = $1", [subject]);
  const target = targetOf(draft, status, body);
  await db.query(
    `INSERT INTO audit_events (at, actor_user_id, actor_name, actor_role, action, target_type, target_id, outcome, address_prefix,
       subject_user_id, tenant_id, token_site_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      new Date(now()),
      draft.actor?.userId ?? null,
      draft.actor?.name ?? null,
      draft.actor?.role ?? null,
      `${draft.method} ${draft.pattern ?? "unknown"}`,
      target.type,
      target.id,
      outcomeFor(status, code),
      draft.addressPrefix,
      subject,
      owner?.tenant_id ?? draft.tokenTenantId,
      draft.tokenSiteId,
    ],
  );
  draft.written = true;
}

/** Writes the success event inside the effect's transaction, just before it commits. */
export async function auditBeforeCommit(db: Db, result: unknown): Promise<boolean> {
  const draft = drafts.getStore();
  if (!draft || draft.written || result === null || typeof result !== "object" || !("kind" in result) || !("status" in result)) return false;
  const reply = result as Reply;
  await write(db, draft, reply.status, null, reply.kind === "json" ? reply.body : null);
  return true;
}

export function auditRolledBack(): void {
  const draft = drafts.getStore();
  if (draft) draft.written = false;
}

/** Writes the event for an answer no transaction carried: a refusal, a replay or a read-only effect. */
export async function auditAnswer(status: number, code: string | null, body: unknown): Promise<void> {
  const draft = drafts.getStore();
  if (!draft || draft.written) return;
  await write(pool, draft, status, code, body);
}

/** The address as the audit stores it: an IPv4 address with its last octet zeroed; null for an IPv6-only peer. */
export function addressPrefix(address: string): string | null {
  const parts = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(address);
  return parts ? `${parts[1]}.${parts[2]}.${parts[3]}.0` : null;
}

interface EventRow {
  id: number;
  at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: Role | null;
  action: string;
  target_type: TargetType | null;
  target_id: string | null;
  outcome: AuditOutcome;
  address_prefix: string | null;
}

// GET /api/audit?since=
export async function listAudit(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const raw = ctx.query.get("since");
  const fields = new Fields({ since: raw }, ["since"]);
  const since = raw !== null && /^[1-9]\d{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null;
  if (raw !== null && since === null) fields.fail("since", "Use a positive whole number.");
  fields.raise();
  const events = await rows<EventRow>(
    pool,
    `SELECT e.id, e.at, e.actor_user_id, e.actor_name, e.actor_role, e.action, e.target_type, e.target_id, e.outcome, e.address_prefix
       FROM audit_events e LEFT JOIN users su ON su.id = e.subject_user_id
      WHERE e.tenant_id = $1 AND ($2::bigint IS NULL OR e.id > $2)
        AND ($3::uuid IS NULL OR e.token_site_id = $3 OR (su.role IN ('kitchen_manager', 'member') AND su.site_id = $3))
      ORDER BY e.id DESC LIMIT 200`,
    [user.tenantId, since, user.role === "kitchen_manager" ? user.siteId : null],
  );
  return json(200, {
    events: events.map((e) => ({
      id: e.id,
      at: isoInstant(e.at.getTime()),
      actor: e.actor_user_id === null || e.actor_name === null || e.actor_role === null ? null : { user_id: e.actor_user_id, name: e.actor_name, role: e.actor_role },
      action: e.action,
      target_type: e.target_type,
      target_id: e.target_id,
      outcome: e.outcome,
      address_prefix: e.address_prefix,
    })),
  });
}


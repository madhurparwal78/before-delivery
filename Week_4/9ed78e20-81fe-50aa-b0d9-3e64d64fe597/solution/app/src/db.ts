import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import { config } from "./config.js";
import { stale } from "./errors.js";
import type {
  Content,
  ReleaseRecord,
  Requisition,
  Application,
  Grant,
  Benefits,
  BenchmarkRow,
  AuditEntry,
  JobKind,
  MailMessage,
} from "./types.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 16,
});
pool.on("error", (error) =>
  console.error("Database connection lost", error.message),
);
export type DB = pg.Pool | pg.PoolClient;
export const id = (): string => randomUUID();
export const now = (): string => new Date().toISOString();
type PendingAudit = Omit<AuditEntry, "seq" | "prev_hash" | "hash">;
const pendingAudit = new WeakMap<pg.PoolClient, PendingAudit[]>();
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  pendingAudit.set(db, []);
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await appendAudit(db, pendingAudit.get(db)!);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    pendingAudit.delete(db);
    db.release();
  }
}
export async function advisory(db: DB, key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}
export async function all<T>(
  db: DB,
  table:
    | "content"
    | "release_records"
    | "requisitions"
    | "applications"
    | "grants"
    | "benefits"
    | "benchmark_rows",
): Promise<T[]> {
  const r = await db.query<{ data: T }>(`SELECT data FROM ${table}`);
  return r.rows.map((x) => x.data);
}
export async function one<T>(
  db: DB,
  table:
    | "content"
    | "release_records"
    | "requisitions"
    | "applications"
    | "grants",
  key: string,
  lock = false,
): Promise<T | undefined> {
  return (
    await db.query<{ data: T }>(
      `SELECT data FROM ${table} WHERE id::text=$1${lock ? " FOR UPDATE" : ""}`,
      [key],
    )
  ).rows[0]?.data;
}
// Versioned records are written conditionally on the version the change started from.
async function conditional(
  db: DB,
  table: "content" | "requisitions" | "applications" | "grants",
  sets: string,
  values: unknown[],
  key: string,
  expected: number,
): Promise<void> {
  const written = await db.query(
    `UPDATE ${table} SET ${sets} WHERE id=$${values.length + 1} AND version=$${values.length + 2}`,
    [...values, key, expected],
  );
  if (!written.rowCount) stale();
}
export async function saveContent(
  db: DB,
  c: Content,
  expected?: number,
): Promise<void> {
  if (expected === undefined)
    await db.query(
      "INSERT INTO content(id,slug,kind,status,version,data) VALUES($1,$2,$3,$4,$5,$6)",
      [c.id, c.slug, c.kind, c.status, c.version, c],
    );
  else
    await conditional(
      db,
      "content",
      "slug=$1,status=$2,version=$3,data=$4",
      [c.slug, c.status, c.version, c],
      c.id,
      expected,
    );
  await db.query(
    "INSERT INTO content_revisions(content_id,version,data) VALUES($1,$2,$3) ON CONFLICT(content_id,version) DO NOTHING",
    [c.id, c.version, c],
  );
}
export async function saveRecord(
  db: DB,
  key: string,
  r: ReleaseRecord,
): Promise<void> {
  await db.query(
    "INSERT INTO release_records(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2",
    [key, r],
  );
}
export async function saveRequisition(
  db: DB,
  r: Requisition,
  expected?: number,
): Promise<void> {
  if (expected === undefined)
    await db.query(
      "INSERT INTO requisitions(id,slug,status,version,data) VALUES($1,$2,$3,$4,$5)",
      [r.id, r.slug, r.status, r.version, r],
    );
  else
    await conditional(
      db,
      "requisitions",
      "status=$1,version=$2,data=$3",
      [r.status, r.version, r],
      r.id,
      expected,
    );
}
export async function saveApplication(
  db: DB,
  a: Application,
  expected?: number,
): Promise<void> {
  if (expected === undefined)
    await db.query(
      "INSERT INTO applications(id,requisition_id,email,token_digest,version,data) VALUES($1,$2,$3,$4,$5,$6)",
      [a.id, a.requisition_id, a.email, a.token_digest, a.version, a],
    );
  else
    await conditional(
      db,
      "applications",
      "email=$1,token_digest=$2,version=$3,data=$4",
      [a.email, a.token_digest, a.version, a],
      a.id,
      expected,
    );
}
export async function saveGrant(
  db: DB,
  g: Grant,
  expected?: number,
): Promise<void> {
  if (expected === undefined)
    await db.query(
      "INSERT INTO grants(id,staff_email,version,data) VALUES($1,$2,$3,$4)",
      [g.id, g.staff_email, g.version, g],
    );
  else
    await conditional(
      db,
      "grants",
      "version=$1,data=$2",
      [g.version, g],
      g.id,
      expected,
    );
}
export async function saveBenefits(db: DB, entry: Benefits): Promise<void> {
  await db.query(
    "INSERT INTO benefits(id,region,effective_from,data) VALUES($1,$2,$3,$4)",
    [entry.id, entry.region, entry.effective_from, entry],
  );
}
export async function saveRow(db: DB, row: BenchmarkRow): Promise<void> {
  await db.query(
    "INSERT INTO benchmark_rows(id,subject,benchmark,eval_date,data) VALUES($1,$2,$3,$4,$5)",
    [row.id, row.subject, row.benchmark, row.eval_date, row],
  );
}
// Canonical JSON for the audit chain: keys sorted at every level, no whitespace.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export const ZERO_HASH = "0".repeat(64);
export function auditHash(
  prev: string,
  entry: Omit<AuditEntry, "id" | "prev_hash" | "hash">,
): string {
  const { seq, at, actor, action, target_type, target_id, detail } = entry;
  return createHash("sha256")
    .update(
      `${prev}\n${canonical({ seq, at, actor, action, target_type, target_id, detail })}`,
      "utf8",
    )
    .digest("hex");
}
export async function audit(
  db: pg.PoolClient,
  actor: string,
  action: string,
  target_type: string,
  target_id: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  pendingAudit.get(db)!.push({
    id: id(),
    at: now(),
    actor,
    action,
    target_type,
    target_id,
    detail,
  });
}
// Entries join the chain at commit, under one lock, so seq follows commit order.
async function appendAudit(
  db: pg.PoolClient,
  entries: PendingAudit[],
): Promise<void> {
  if (!entries.length) return;
  await advisory(db, "audit-chain");
  const head = (
    await db.query<{ seq: string; hash: string }>(
      "SELECT seq,hash FROM audit_entries ORDER BY seq DESC LIMIT 1",
    )
  ).rows[0];
  let seq = head ? Number(head.seq) : 0,
    prev = head?.hash || ZERO_HASH;
  for (const entry of entries) {
    seq++;
    const hash = auditHash(prev, { ...entry, seq });
    await db.query(
      "INSERT INTO audit_entries(seq,id,at,actor,action,target_type,target_id,detail,prev_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        seq,
        entry.id,
        entry.at,
        entry.actor,
        entry.action,
        entry.target_type,
        entry.target_id,
        entry.detail,
        prev,
        hash,
      ],
    );
    prev = hash;
  }
}
export async function enqueueJob(
  db: DB,
  kind: JobKind,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.query("INSERT INTO jobs(kind,payload) VALUES($1,$2)", [
    kind,
    payload,
  ]);
}
export async function enqueueMail(
  db: DB,
  to: { name: string; email: string },
  subject: string,
  body: string,
): Promise<void> {
  const message: MailMessage = {
    to_name: to.name,
    to_email: to.email,
    subject,
    body,
  };
  await enqueueJob(db, "mail", { ...message });
}
export async function staffName(db: DB, email: string): Promise<string> {
  return (
    await db.query<{ name: string }>("SELECT name FROM staff WHERE email=$1", [
      email,
    ])
  ).rows[0].name;
}
export async function schema(): Promise<void> {
  await transaction(async (db) => {
    await advisory(db, "schema");
    await db.query(`
CREATE TABLE IF NOT EXISTS staff(email text PRIMARY KEY,name text NOT NULL,password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS grants(id text PRIMARY KEY,staff_email text NOT NULL REFERENCES staff(email),version integer NOT NULL,data jsonb NOT NULL,expiry_notified boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sessions(digest text PRIMARY KEY,email text NOT NULL REFERENCES staff(email),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS signin_failures(email text PRIMARY KEY,failures integer NOT NULL DEFAULT 0,lock_seconds integer NOT NULL DEFAULT 0,locked_until timestamptz);
CREATE TABLE IF NOT EXISTS content(id text PRIMARY KEY,slug text UNIQUE NOT NULL,kind text NOT NULL,status text NOT NULL,version integer NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS content_revisions(content_id text NOT NULL REFERENCES content(id),version integer NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(content_id,version));
CREATE TABLE IF NOT EXISTS embargo_schedules(content_id text PRIMARY KEY REFERENCES content(id),release_at timestamptz NOT NULL,scheduled_by text NOT NULL);
CREATE TABLE IF NOT EXISTS publication_history(content_id text PRIMARY KEY REFERENCES content(id),published_at timestamptz NOT NULL,withdrawn_at timestamptz);
CREATE TABLE IF NOT EXISTS release_records(id text PRIMARY KEY REFERENCES content(id),data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS benchmark_rows(id text PRIMARY KEY,subject text NOT NULL,benchmark text NOT NULL,eval_date text NOT NULL,data jsonb NOT NULL,UNIQUE(subject,benchmark,eval_date));
CREATE TABLE IF NOT EXISTS search_documents(kind text NOT NULL,slug text NOT NULL,title text NOT NULL,summary text NOT NULL,body text NOT NULL,published_at timestamptz NOT NULL,document tsvector NOT NULL,PRIMARY KEY(kind,slug));
CREATE INDEX IF NOT EXISTS search_documents_document ON search_documents USING gin(document);
CREATE TABLE IF NOT EXISTS requisitions(id text PRIMARY KEY,slug text UNIQUE NOT NULL,status text NOT NULL,version integer NOT NULL,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS benefits(id text PRIMARY KEY,region text NOT NULL,effective_from text NOT NULL,data jsonb NOT NULL,UNIQUE(region,effective_from));
CREATE TABLE IF NOT EXISTS applications(id text PRIMARY KEY,requisition_id text NOT NULL REFERENCES requisitions(id),email text NOT NULL,token_digest text UNIQUE,version integer NOT NULL,data jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS application_email_unique ON applications(requisition_id,email) WHERE email<>'';
CREATE TABLE IF NOT EXISTS resend_requests(email text NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS resend_requests_email ON resend_requests(email,at);
CREATE TABLE IF NOT EXISTS rate_limits(bucket text NOT NULL,key text NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL,PRIMARY KEY(bucket,key));
CREATE TABLE IF NOT EXISTS idempotency_keys(scope text NOT NULL,key text NOT NULL,fingerprint text NOT NULL,status integer,body text,headers jsonb,expires_at timestamptz NOT NULL,PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS jobs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,kind text NOT NULL,state text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,refusals integer NOT NULL DEFAULT 0,last_error text,next_attempt_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,lease_until timestamptz,payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS audit_entries(seq bigint PRIMARY KEY,id text UNIQUE NOT NULL,at text NOT NULL,actor text NOT NULL,action text NOT NULL,target_type text NOT NULL,target_id text NOT NULL,detail jsonb NOT NULL,prev_hash text NOT NULL,hash text NOT NULL);
CREATE INDEX IF NOT EXISTS audit_entries_target ON audit_entries(target_id);
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit entries cannot be changed or removed.'; END $$;
DROP TRIGGER IF EXISTS immutable_audit ON audit_entries;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
`);
  });
}

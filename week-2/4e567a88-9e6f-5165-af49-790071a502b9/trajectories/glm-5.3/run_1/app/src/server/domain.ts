// Domain rules decided in exactly one place: access resolution, payload visibility,
// rate selection, projections, periods, caps and meter building.
import type { Pool, Tx } from "./db.js";
import type { ModelDef, UnitCount } from "../shared/models.js";
import { CATALOGUE, modelBySlug, estimatedUnits, billedUnits, unitString } from "../shared/models.js";
import { microForUnits } from "../shared/money.js";
import { budgetPeriod } from "../shared/time.js";

export type Role = "member" | "admin" | "finance" | "compliance";
export type Access = "allowed" | "blocked";
export type Context = "api" | "playground";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_id: string | null;
}

export interface JobRow {
  id: string;
  team_id: string;
  model_slug: string;
  status: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";
  priority: "high" | "normal" | "low";
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  attempts: number;
  failure_reason: string | null;
  waiting_reason: string | null;
  rate_id: string;
  micro_per_unit: number;
  est_num: bigint;
  est_den: bigint;
  billed_num: bigint | null;
  billed_den: bigint | null;
  reserved_micro: number;
  charged_micro: number | null;
  released_micro: number;
  input: unknown;
  context: Context;
}

export interface AssetRow {
  id: string;
  team_id: string;
  kind: "upload" | "output";
  media_type: string;
  job_id: string | null;
  model_slug: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  bytes: number;
  created_at: Date;
  expires_at: Date;
  object_key: string;
  state: "live" | "gone";
  removed_at: Date | null;
  removed_reason: string | null;
  uploaded_by: string | null;
}

export const ORG_ID = "org";

export function catalogue(): ModelDef[] {
  return CATALOGUE;
}

export function modelDef(slug: string): ModelDef {
  const m = modelBySlug(slug);
  if (!m) throw new Error(`unknown model ${slug}`);
  return m;
}

/** Model access resolution: team setting, team context default, org setting. */
export async function resolveAccess(
  q: Pool | Tx,
  teamId: string | null,
  slug: string,
  context: Context,
): Promise<Access> {
  let setting: string | undefined;
  if (teamId) {
    const teamRow = await q.one<{ api: string; playground: string }>(
      `SELECT api, playground FROM team_model_access WHERE team_id = $1 AND model_slug = $2`,
      [teamId, slug],
    );
    if (teamRow) {
      setting = context === "api" ? teamRow.api : teamRow.playground;
      if (setting !== "inherit") return setting === "allowed" ? "allowed" : "blocked";
    }
    const team = await q.one<{ api_default: string; playground_default: string }>(
      `SELECT api_default, playground_default FROM teams WHERE id = $1`,
      [teamId],
    );
    if (team) {
      setting = context === "api" ? team.api_default : team.playground_default;
      if (setting !== "inherit") return setting === "allowed" ? "allowed" : "blocked";
    }
  }
  const orgRow = await q.one<{ api: string; playground: string }>(
    `SELECT api, playground FROM org_model_access WHERE model_slug = $1`,
    [slug],
  );
  setting = context === "api" ? orgRow?.api ?? "allowed" : orgRow?.playground ?? "allowed";
  return setting === "allowed" ? "allowed" : "blocked";
}

/** The rate in effect at the submission instant: latest effective_at <= submitted_at. */
export async function rateAt(
  q: Pool | Tx,
  slug: string,
  submittedAt: Date,
): Promise<{ id: string; micro_per_unit: number }> {
  const row = await q.one<{ id: string; micro_per_unit: bigint }>(
    `SELECT id, micro_per_unit FROM rates
     WHERE model_slug = $1 AND effective_at <= $2
     ORDER BY effective_at DESC, created_at DESC LIMIT 1`,
    [slug, submittedAt],
  );
  if (!row) throw new Error(`no rate for ${slug}`);
  return { id: row.id, micro_per_unit: Number(row.micro_per_unit) };
}

export function estimateUnits(slug: string, input: Record<string, unknown>): UnitCount {
  return estimatedUnits(modelDef(slug), input);
}

export function billableUnits(slug: string, input: Record<string, unknown>): UnitCount {
  return billedUnits(modelDef(slug), input);
}

/** Reservation = estimated units × rate, rounded once half-up. */
export function reservationMicro(slug: string, input: Record<string, unknown>, microPerUnit: number): number {
  const u = estimateUnits(slug, input);
  return microForUnits(u.num, u.den, microPerUnit);
}

/** Charge = billed units × rate, rounded once half-up. */
export function chargeMicro(slug: string, input: Record<string, unknown>, microPerUnit: number): number {
  const u = billableUnits(slug, input);
  return microForUnits(u.num, u.den, microPerUnit);
}

/** Whether a caller may see a job's payload, decided at read time. */
export async function payloadVisibleTo(
  q: Pool | Tx,
  job: { team_id: string; submitted_by: string },
  caller: MemberRow,
): Promise<boolean> {
  // Members of other teams never see a job's payload; org roles follow the team's setting.
  if (caller.team_id !== null && caller.team_id !== job.team_id) return false;
  if (caller.id === job.submitted_by) return true;
  const team = await q.one<{ payload_visibility: string }>(
    `SELECT payload_visibility FROM teams WHERE id = $1`,
    [job.team_id],
  );
  return (team?.payload_visibility ?? "team") === "team";
}

/** A movement with its two balanced entries. */
export async function recordMovement(
  tx: Tx,
  teamId: string,
  kind: "opening_grant" | "top_up" | "reserve" | "settle" | "release",
  minus: { account: string; amountMicro: number },
  plus: { account: string; amountMicro: number },
  refs: { jobId?: string; topupId?: string; kbInvoiceId?: string },
): Promise<string> {
  const seq = await tx.one<{ nextval: number }>(`SELECT nextval('movement_seq') AS nextval`);
  const id = `mv_${seq?.nextval}`;
  await tx.exec(
    `INSERT INTO ledger_movements (id, team_id, kind, job_id, topup_id, kb_invoice_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, teamId, kind, refs.jobId ?? null, refs.topupId ?? null, refs.kbInvoiceId ?? null],
  );
  await tx.exec(
    `INSERT INTO ledger_entries (movement_id, account, amount_micro) VALUES ($1,$2,$3),($1,$4,$5)`,
    [id, minus.account, -BigInt(minus.amountMicro), plus.account, BigInt(plus.amountMicro)],
  );
  return id;
}

export interface Balances {
  granted: number;
  available: number;
  reserved: number;
  settled: number;
}

export async function balances(q: Pool | Tx, teamId: string): Promise<Balances> {
  const rows = await q.many<{ account: string; total: bigint }>(
    `SELECT account, COALESCE(sum(amount_micro),0)::bigint AS total FROM ledger_entries WHERE movement_id IN (SELECT id FROM ledger_movements WHERE team_id = $1) GROUP BY account`,
    [teamId],
  );
  const by: Record<string, number> = { funding: 0, available: 0, reserved: 0, settled: 0 };
  for (const r of rows) by[r.account] = Number(r.total);
  return { granted: by.available + by.reserved + by.settled, available: by.available, reserved: by.reserved, settled: by.settled };
}

export interface PeriodInfo {
  label: string;
  startsAt: Date;
  endsAt: Date;
  softCapMicro: number;
  hardCapMicro: number;
}

export async function periodFor(q: Pool | Tx, teamId: string): Promise<PeriodInfo> {
  const org = await q.one<{ timezone: string }>(`SELECT timezone FROM orgs WHERE id = 'org'`);
  const team = await q.one<{ soft_cap_credits: number; hard_cap_credits: number }>(
    `SELECT soft_cap_credits, hard_cap_credits FROM teams WHERE id = $1`,
    [teamId],
  );
  const zone = org?.timezone ?? "UTC";
  const p = budgetPeriod(new Date(), zone);
  return {
    label: p.label,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    softCapMicro: (team?.soft_cap_credits ?? 0) * 1_000_000,
    hardCapMicro: (team?.hard_cap_credits ?? 0) * 1_000_000,
  };
}

export interface PeriodSpend {
  spendMicro: number;
  succeededChargesMicro: number;
  reservedNowMicro: number;
}

/** Period spend: charges of succeeded jobs submitted in the period plus current reservations of in-flight jobs submitted in the period. */
export async function periodSpend(q: Pool | Tx, teamId: string, period: PeriodInfo): Promise<PeriodSpend> {
  const row = await q.one<{ succeeded: bigint; inflight: bigint }>(
    `SELECT
       COALESCE(sum(charged_micro),0)::bigint AS succeeded,
       COALESCE(sum(CASE WHEN status IN ('queued','leased','running') THEN reserved_micro ELSE 0 END),0)::bigint AS inflight
     FROM jobs
     WHERE team_id = $1 AND submitted_at >= $2 AND submitted_at < $3
       AND (status = 'succeeded' OR status IN ('queued','leased','running'))`,
    [teamId, period.startsAt, period.endsAt],
  );
  const succeeded = Number(row?.succeeded ?? 0n);
  const inflight = Number(row?.inflight ?? 0n);
  return { spendMicro: succeeded + inflight, succeededChargesMicro: succeeded, reservedNowMicro: inflight };
}

export type CapState = "under" | "soft_cap_passed" | "hard_cap_reached";

/** The meter object for a team. */
export async function meterFor(
  q: Pool,
  teamId: string,
  recentReplays: { job_id: string; at: Date }[],
): Promise<unknown> {
  const b = await balances(q, teamId);
  const period = await periodFor(q, teamId);
  const spend = await periodSpend(q, teamId, period);
  const inFlight = await q.many<{
    id: string;
    status: JobRow["status"];
    reserved_micro: number;
    est_num: string;
    est_den: string;
    unit: string;
  }>(
    `SELECT j.id, j.status, j.reserved_micro, j.est_num, j.est_den, m.unit
     FROM jobs j JOIN models m ON m.slug = j.model_slug
     WHERE j.team_id = $1 AND j.status IN ('queued','leased','running')
     ORDER BY j.submitted_at ASC, j.id ASC`,
    [teamId],
  );
  const throttled = await q.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM refusals WHERE team_id = $1 AND at >= $2 AND at < $3 AND reason = 'budget_hard_cap'`,
    [teamId, period.startsAt, period.endsAt],
  );
  let capState: CapState = "under";
  if (spend.spendMicro >= period.hardCapMicro || (throttled?.n ?? 0) > 0) capState = "hard_cap_reached";
  else if (spend.spendMicro >= period.softCapMicro) capState = "soft_cap_passed";
  const softOffset = b.settled + b.reserved - spend.spendMicro + period.softCapMicro;
  return {
    team_id: teamId,
    granted_micro: b.granted,
    available_micro: b.available,
    reserved_micro: b.reserved,
    settled_micro: b.settled,
    in_flight: inFlight.map((j) => ({
      job_id: j.id,
      status: j.status,
      reserved_micro: Number(j.reserved_micro),
      estimated_units: unitStringOf({ num: BigInt(j.est_num), den: BigInt(j.est_den) }),
      unit: j.unit,
    })),
    recent_replays: recentReplays,
    period: {
      label: period.label,
      starts_at: iso(period.startsAt),
      ends_at: iso(period.endsAt),
      spend_micro: spend.spendMicro,
      soft_cap_micro: period.softCapMicro,
      hard_cap_micro: period.hardCapMicro,
      soft_cap_offset_micro: softOffset,
    },
    cap_state: capState,
  };
}

export function unitStringOf(u: UnitCount): string {
  return unitString(u);
}

/** Project a job for a caller, applying payload visibility. */
export function projectJob(job: JobRow, visible: boolean, queuePosition: number | null): Record<string, unknown> {
  const model = modelDef(job.model_slug);
  const est: UnitCount = { num: job.est_num, den: job.est_den };
  const billed: UnitCount | null = job.billed_num !== null && job.billed_den !== null ? { num: job.billed_num, den: job.billed_den } : null;
  const base: Record<string, unknown> = {
    id: job.id,
    team_id: job.team_id,
    model: job.model_slug,
    status: job.status,
    priority: job.priority,
    submitted_by: { id: job.submitted_by, name: job.submitted_by_name },
    submitted_at: iso(job.submitted_at),
    started_at: job.started_at ? iso(job.started_at) : null,
    finished_at: job.finished_at ? iso(job.finished_at) : null,
    attempts: job.attempts,
    failure_reason: job.failure_reason,
    waiting_reason: job.waiting_reason,
    queue_position: queuePosition,
    rate: { id: job.rate_id, micro_per_unit: job.micro_per_unit },
    unit: model.unit,
    estimated_units: unitStringOf(est),
    billed_units: billed ? unitStringOf(billed) : null,
    reserved_micro: job.reserved_micro,
    charged_micro: job.charged_micro,
    released_micro: job.released_micro,
    outputs: [] as string[],
    payload_visible: visible,
  };
  if (visible) {
    base.input = job.input;
    base.input_assets = inputAssetRefs(job.input, model);
  }
  return base;
}

function inputAssetRefs(input: unknown, model: ModelDef): string[] {
  const refs: string[] = [];
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const f of model.fields) {
      if (f.type === "media") {
        const v = obj[f.name];
        if (typeof v === "string" && v.startsWith("asset:")) refs.push(v.slice("asset:".length));
      }
    }
  }
  return refs;
}


export function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}


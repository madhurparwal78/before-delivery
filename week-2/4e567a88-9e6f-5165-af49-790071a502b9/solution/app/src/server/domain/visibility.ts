// Payload visibility and every projection that depends on it: jobs, assets, lineage edges, search, CSV.

import type { Db } from "../db";
import { rows } from "../db";
import { promptOf } from "../../shared/schema";
import { unitsText, type Unit } from "../../shared/units";
import type { Context, PayloadVisibility, Policy } from "./policy";
import { teamPolicy } from "./policy";

export type Role = "member" | "admin" | "finance" | "compliance";

export interface Viewer {
  id: string;
  role: Role;
  team_id: string | null;
}

export type JobStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRow {
  number: bigint;
  id: string;
  team_id: string;
  model: string;
  status: JobStatus;
  priority: "high" | "normal" | "low";
  submitted_by: string;
  submitter_name: string;
  submitted_at: Date;
  submitted_context: Context;
  started_at: Date | null;
  finished_at: Date | null;
  attempts: number;
  lapses: number;
  lease_expires_at: Date | null;
  failure_reason: string | null;
  rate_id: string;
  rate_micro: bigint;
  unit: Unit;
  estimated_units_micro: bigint;
  billed_units_micro: bigint | null;
  reserved_micro: bigint;
  charged_micro: bigint | null;
  released_micro: bigint;
  outputs: string[];
  queue_position: bigint | null;
  input: Record<string, string | number>;
  input_assets: string[];
}

/** One SELECT for every job read, so released amounts, outputs and queue positions agree everywhere. */
const JOB_SELECT = `
  SELECT j.*, m.name AS submitter_name,
    COALESCE((SELECT SUM(e.amount_micro) FROM movements mv JOIN entries e
      ON e.movement_number = mv.number AND e.account = 'available'
      WHERE mv.job_id = j.id AND mv.kind = 'release'), 0)::bigint AS released_micro,
    COALESCE((SELECT array_agg(a.id ORDER BY a.output_index) FROM assets a
      WHERE a.job_id = j.id AND a.kind = 'output'), '{}') AS outputs,
    CASE WHEN j.status = 'queued' THEN (SELECT count(*) FROM jobs q
      WHERE q.team_id = j.team_id AND q.status = 'queued'
        AND (q.priority_rank, q.submitted_at, q.number) <= (j.priority_rank, j.submitted_at, j.number)) END
      AS queue_position
  FROM jobs j JOIN members m ON m.id = j.submitted_by`;

export async function loadJobs(db: Db, where: string, params: unknown[], tail = ""): Promise<JobRow[]> {
  return rows<JobRow>(db, `${JOB_SELECT} WHERE ${where} ${tail}`, params);
}

/** Who may see a job's input and input media. */
function canSeePayload(viewer: Viewer, job: { team_id: string; submitted_by: string }, visibility: PayloadVisibility): boolean {
  if (viewer.role === "member" && viewer.team_id !== job.team_id) return false;
  return visibility === "team" || viewer.id === job.submitted_by;
}

function payloadVisibility(policy: Policy, teamId: string): PayloadVisibility {
  return teamPolicy(policy, teamId).payload_visibility;
}

const iso = (at: Date | null): string | null => (at ? at.toISOString() : null);

type JobView = Record<string, unknown>;

export function projectJob(job: JobRow, viewer: Viewer, policy: Policy, storageDown: boolean): JobView {
  const visible = canSeePayload(viewer, job, payloadVisibility(policy, job.team_id));
  const view: JobView = {
    id: job.id,
    team_id: job.team_id,
    model: job.model,
    status: job.status,
    priority: job.priority,
    submitted_by: { id: job.submitted_by, name: job.submitter_name },
    submitted_at: iso(job.submitted_at),
    started_at: iso(job.started_at),
    finished_at: iso(job.finished_at),
    attempts: job.attempts,
    failure_reason: job.failure_reason,
    waiting_reason: job.status === "queued" && storageDown ? "storage_unavailable" : null,
    queue_position: job.queue_position === null ? null : Number(job.queue_position),
    rate: { id: job.rate_id, micro_per_unit: job.rate_micro },
    unit: job.unit,
    estimated_units: unitsText(job.estimated_units_micro),
    billed_units: job.billed_units_micro === null ? null : unitsText(job.billed_units_micro),
    reserved_micro: job.reserved_micro,
    charged_micro: job.charged_micro,
    released_micro: job.released_micro,
    outputs: job.outputs,
    payload_visible: visible,
  };
  if (visible) {
    view.input = job.input;
    view.input_assets = job.input_assets;
  }
  return view;
}

/** The prompt or script of a job, or "" when the reader may not see the payload. */
export function visiblePrompt(job: JobRow, viewer: Viewer, policy: Policy): string {
  if (!canSeePayload(viewer, job, payloadVisibility(policy, job.team_id))) return "";
  return promptOf(job.input);
}

export interface AssetRow {
  number: bigint;
  id: string;
  team_id: string;
  kind: "upload" | "output";
  media_type: string;
  job_id: string | null;
  model: string | null;
  model_name: string | null;
  owner_id: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  bytes: bigint;
  object_key: string;
  created_at: Date;
  expires_at: Date;
  removed_at: Date | null;
  object_removed: boolean;
  job_submitted_by: string | null;
  job_input: Record<string, string | number> | null;
}

export const ASSET_SELECT = `
  SELECT a.*, j.model AS model, md.name AS model_name, j.submitted_by AS job_submitted_by, j.input AS job_input
  FROM assets a LEFT JOIN jobs j ON j.id = a.job_id LEFT JOIN models md ON md.slug = j.model`;

export type AssetAccess = "hidden" | "full" | "without_link";

/** Whether a caller may read an asset while it is live, and whether its signed link is included. */
export function assetAccess(viewer: Viewer, asset: AssetRow, policy: Policy): AssetAccess {
  if (asset.kind === "output") return "full";
  if (viewer.role === "member" && viewer.team_id !== asset.team_id) return "hidden";
  if (payloadVisibility(policy, asset.team_id) === "team" || viewer.id === asset.owner_id) return "full";
  return viewer.role === "admin" || viewer.role === "compliance" ? "without_link" : "hidden";
}

/** Prompt and derived-from edges of an output follow its producing job's payload visibility. */
export function outputPayloadVisible(viewer: Viewer, asset: AssetRow, policy: Policy): boolean {
  return asset.kind === "output" && asset.job_submitted_by !== null
    && canSeePayload(viewer, { team_id: asset.team_id, submitted_by: asset.job_submitted_by }, payloadVisibility(policy, asset.team_id));
}

type Removal = { removed_at: Date; reason: "deleted" | "expired" } | null;

/** From `expires_at`, an asset behaves as deleted with reason expired. */
export function removal(asset: AssetRow, now: Date): Removal {
  if (asset.removed_at) return { removed_at: asset.removed_at, reason: "deleted" };
  if (asset.expires_at <= now) return { removed_at: asset.expires_at, reason: "expired" };
  return null;
}

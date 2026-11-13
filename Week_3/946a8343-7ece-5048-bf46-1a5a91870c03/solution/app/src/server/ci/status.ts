// Job statuses, the stage and pipeline rollup, and when a job in `created` may move on (DP-25).
import type { JobWhen } from "./config/types.ts";
import { isOneOf } from "../json.ts";

const JOB_STATUSES = [
  "created", "pending", "running", "success", "failed", "canceled", "skipped", "manual", "scheduled", "warning",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RolledStatus = JobStatus | "blocked";

const FINISHED: ReadonlySet<string> = new Set<JobStatus>(["success", "failed", "canceled", "skipped", "warning"]);

export function isJobStatus(value: unknown): value is JobStatus {
  return isOneOf(JOB_STATUSES, value);
}

/** A finished job will not change by itself; a finished pipeline status is one of these. */
export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

export const FINISHED_STATUSES: readonly string[] = [...FINISHED];

interface RollupJob {
  readonly status: JobStatus;
  readonly allowFailure: boolean;
}

/** Stage and pipeline status from the latest attempt of each job: the first matching rule of the brief. */
export function rollup(jobs: readonly RollupJob[]): RolledStatus {
  const has = (status: JobStatus): boolean => jobs.some((job) => job.status === status);
  if (jobs.every((job) => job.status === "created")) return "created";
  if (has("running") || has("pending") || has("created")) return "running";
  if (jobs.some((job) => job.status === "manual" && !job.allowFailure)) return "blocked";
  if (has("failed")) return "failed";
  if (has("canceled")) return "canceled";
  if (has("warning")) return "warning";
  if (jobs.every((job) => job.status === "skipped")) return "skipped";
  if (has("scheduled")) return "scheduled";
  return "success";
}

export interface GraphJob {
  readonly name: string;
  readonly stageIndex: number;
  readonly status: JobStatus;
  readonly allowFailure: boolean;
}

interface WaitingJob {
  readonly stageIndex: number;
  readonly needs: readonly string[] | null;
  readonly when: JobWhen;
}

type Verdict = "wait" | "skip" | "go";

/** Whether a `created` job is ready (`go`), can never run (`skip`) or has to wait for jobs that are not finished. */
export function judge(job: WaitingJob, latest: readonly GraphJob[]): Verdict {
  const byNeeds = job.needs !== null;
  const deps = byNeeds
    ? latest.filter((candidate) => job.needs?.includes(candidate.name) === true)
    : latest.filter((candidate) => candidate.stageIndex < job.stageIndex);
  const finished = (dep: GraphJob): boolean =>
    isFinished(dep.status) || (!byNeeds && dep.status === "manual" && dep.allowFailure);
  if (!deps.every(finished)) return "wait";
  if (job.when === "always") return "go";
  if (job.when === "on_failure") return deps.some((dep) => dep.status === "failed") ? "go" : "skip";
  const good = (dep: GraphJob): boolean =>
    dep.status === "success" ||
    dep.status === "warning" ||
    (!byNeeds && (dep.status === "skipped" || dep.status === "manual"));
  return deps.every(good) ? "go" : "skip";
}

/** What a job that is ready becomes, before any environment gate. */
export function statusFor(when: JobWhen): "pending" | "manual" | "scheduled" {
  if (when === "manual") return "manual";
  if (when === "delayed") return "scheduled";
  return "pending";
}

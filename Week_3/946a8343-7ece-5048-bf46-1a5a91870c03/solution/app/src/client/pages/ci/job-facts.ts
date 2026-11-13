// What the pages say about a job: its duration words, whether it is finished, and the buttons it may have.
import type { JobSummary } from "./types.ts";

const FINISHED = new Set(["success", "failed", "canceled", "skipped", "warning"]);

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

/** `not started`, `in progress`, `<s>s` or `<m>m <s>s`, from the server's times. */
export function durationText(job: Pick<JobSummary, "started_at" | "finished_at">): string {
  if (job.started_at === null) return "not started";
  if (job.finished_at === null) return "in progress";
  const seconds = Math.max(0, Math.floor((Date.parse(job.finished_at) - Date.parse(job.started_at)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The latest attempt of every job, in the order the pipeline lists its jobs. */
export function latestJobs(jobs: readonly JobSummary[]): JobSummary[] {
  return jobs.filter((job) => !job.retried);
}

export function jobPath(project: number, jobId: number): string {
  return `/projects/${project}/-/jobs/${jobId}`;
}

export function pipelinePath(project: number, pipelineId: number): string {
  return `/projects/${project}/-/pipelines/${pipelineId}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

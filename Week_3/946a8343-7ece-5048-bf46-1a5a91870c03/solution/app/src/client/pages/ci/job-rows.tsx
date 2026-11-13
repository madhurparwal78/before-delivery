// `list "Jobs"`: one flat row per job attempt (retried attempts stay listed) with its status, duration and the buttons its
// state and the viewer's role allow.
import { api, type ApiError } from "../../api.ts";
import { A } from "../../router.ts";
import { StatusBadge, Time } from "../../ui/index.ts";
import { ActionButton } from "./action-button.tsx";
import { durationText, isFinished, jobPath } from "./job-facts.ts";
import type { JobSummary } from "./types.ts";

function jobLabel(job: JobSummary): string {
  return `Job ${job.name}, stage ${job.stage}, ${job.status}, ${durationText(job)}`;
}

interface JobButtons {
  /** The viewer may run, retry and cancel jobs. */
  canRun: boolean;
  onFailure(error: ApiError | null): void;
  onDone(): void;
}

/** The job's own buttons: `Play <job>`, `Retry job`, `Cancel job`. */
export function JobActions({ job, buttons }: { job: JobSummary; buttons: JobButtons }) {
  if (!buttons.canRun || job.retried) return null;
  const common = { onFailure: buttons.onFailure, onDone: buttons.onDone };
  return (
    <>
      {job.status === "manual" ? (
        <ActionButton {...common} run={() => api.post(`/api/jobs/${job.id}/play`, { variables: {} })}>{`Play ${job.name}`}</ActionButton>
      ) : null}
      {isFinished(job.status) ? (
        <ActionButton {...common} run={() => api.post(`/api/jobs/${job.id}/retry`)}>
          Retry job
        </ActionButton>
      ) : (
        <ActionButton {...common} run={() => api.post(`/api/jobs/${job.id}/cancel`)}>
          Cancel job
        </ActionButton>
      )}
    </>
  );
}

export function JobRows({ project, jobs, buttons }: { project: number; jobs: readonly JobSummary[]; buttons: JobButtons }) {
  return (
    <ul role="list" aria-label="Jobs" class="sp-job-rows">
      {jobs.map((job) => (
        <li key={job.id} class="sp-job-row" aria-label={jobLabel(job)} data-retried={job.retried ? "true" : undefined} data-flash={job.id}>
          <div class="sp-job-row__main">
            <A href={jobPath(project, job.id)} class="sp-job-row__name sp-mono">
              {job.name}
            </A>
            <span class="sp-job-row__stage sp-mono">{job.stage}</span>
            <StatusBadge status={job.status} />
            <span class="sp-job-row__duration">{durationText(job)}</span>
            {job.status === "scheduled" && job.start_at !== null ? (
              <span class="sp-job-row__start">
                Starts at <Time iso={job.start_at} />
              </span>
            ) : null}
          </div>
          <div class="sp-job-row__actions">
            <JobActions job={job} buttons={buttons} />
          </div>
        </li>
      ))}
    </ul>
  );
}

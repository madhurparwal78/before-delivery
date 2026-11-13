import { useRef, useState } from "preact/hooks";
import { api, type ApiError } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { A, useFocusOnArrival, useRoute } from "../router.ts";
import { Notice, Page, Skeleton, StatusBadge, Time } from "../ui/index.ts";
import "../styles/ci.css";
import { ActionButton } from "./ci/action-button.tsx";
import { failureText } from "./ci/failure-text.ts";
import { durationText, pipelinePath } from "./ci/job-facts.ts";
import { useJobLog } from "./ci/job-log-data.ts";
import { JobActions } from "./ci/job-rows.tsx";
import { JobLog } from "./ci/log-view.tsx";
import type { JobDetail } from "./ci/types.ts";

function artifactHref(jobId: number, path: string): string {
  return `/api/jobs/${jobId}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export default function JobPage() {
  const { params } = useRoute();
  const project = Number(params.id);
  const id = Number(params.job);
  const { atLeast } = useRole();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useFocusOnArrival(logRef);
  const resource = useLiveResource<JobDetail>({
    project,
    types: ["job"],
    load: (signal) => api.get<JobDetail>(`/api/jobs/${id}`, { signal }),
    deps: [project, id],
    match: (message) => message.data.job_id === id,
  });
  const log = useJobLog(project, id);
  const job = resource.data;
  const canRun = atLeast("developer");
  const buttons = { canRun, onFailure: setFailure, onDone: () => void resource.reload() };
  const reason = job ? failureText(job, log.lines) : null;
  const stored = job?.artifacts.filter((artifact) => !artifact.expired) ?? [];

  return (
    <Page title={job?.name ?? "Job"} project={params.id} live pageKeys={[`job:${id}`]}>
      <div class="sp-ci-page">
        {resource.error && !job ? <Notice>{resource.error.message}</Notice> : null}
        {failure ? <Notice>{failure.message}</Notice> : null}
        {!job && !resource.error ? <Skeleton rows={2} height={64} /> : null}
        {job ? (
          <div class="sp-factbar">
            <StatusBadge status={job.status} />
            <span class="sp-mono">{job.stage}</span>
            <span>{durationText(job)}</span>
            <A href={pipelinePath(project, job.pipeline_id)}>{`Pipeline ${job.pipeline_id}`}</A>
            {job.environment?.id != null ? <A href={`/projects/${project}/-/environments/${job.environment.id}`}>{job.environment.name}</A> : null}
            {job.status === "scheduled" && job.start_at !== null ? (
              <span>
                Starts at <Time iso={job.start_at} />
              </span>
            ) : null}
            <div class="sp-factbar__actions">
              <JobActions job={job} buttons={buttons} />
            </div>
          </div>
        ) : null}
        {reason ? <Notice>{reason}</Notice> : null}
        {stored.length > 0 ? (
          <section class="sp-artifacts" aria-label="Artifacts">
            <ul role="list">
              {stored.map((artifact) => (
                <li key={artifact.path} class="sp-artifacts__item">
                  <a href={artifactHref(id, artifact.path)} download class="sp-mono">{`Download ${artifact.path}`}</a>
                  <span class="sp-muted sp-small">{`${artifact.size} bytes`}</span>
                  {artifact.expires_at !== null ? (
                    <span class="sp-muted sp-small">
                      Expires <Time iso={artifact.expires_at} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {canRun && stored.some((artifact) => artifact.expires_at !== null) ? (
              <ActionButton {...buttons} run={() => api.post(`/api/jobs/${id}/artifacts/keep`)}>
                Keep artifacts
              </ActionButton>
            ) : null}
          </section>
        ) : null}
        <JobLog lines={log.lines} logRef={logRef} loading={log.loading} />
      </div>
    </Page>
  );
}

import { useRef, useState } from "preact/hooks";
import { api, type ApiError } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { A, useRoute } from "../router.ts";
import { StatusBadge, Notice, Skeleton, Time, Page } from "../ui/index.ts";
import "../styles/ci.css";
import { ActionButton } from "./ci/action-button.tsx";
import { useJobFlash } from "./ci/job-flash.ts";
import { shortSha } from "./ci/job-facts.ts";
import { JobRows } from "./ci/job-rows.tsx";
import { PipelineGraph } from "./ci/pipeline-graph.tsx";
import { StageCards } from "./ci/stage-cards.tsx";
import type { PipelineDetail } from "./ci/types.ts";

const PIPELINE_FINISHED = new Set(["success", "failed", "canceled", "skipped", "warning"]);

export default function PipelinePage() {
  const { params } = useRoute();
  const project = Number(params.id);
  const id = Number(params.pipeline);
  const { atLeast } = useRole();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const resource = useLiveResource<PipelineDetail>({
    project,
    types: ["pipeline", "job"],
    load: (signal) => api.get<PipelineDetail>(`/api/pipelines/${id}`, { signal }),
    deps: [project, id],
    match: (message) => message.data.pipeline_id === id,
  });
  const root = useRef<HTMLDivElement>(null);
  const pipeline = resource.data;
  useJobFlash(root, pipeline?.jobs);

  const canRun = atLeast("developer");
  const buttons = { canRun, onFailure: setFailure, onDone: () => void resource.reload() };
  const jobs = pipeline ? orderJobs(pipeline) : [];
  const retryable = pipeline?.jobs.some((job) => !job.retried && (job.status === "failed" || job.status === "canceled")) ?? false;

  return (
    <Page title={`Pipeline ${id}`} project={params.id} live pageKeys={[`pipeline:${id}`]}>
      <div ref={root} class="sp-ci-page">
        {resource.error && !pipeline ? <Notice>{resource.error.message}</Notice> : null}
        {failure ? <Notice>{failure.message}</Notice> : null}
        {!pipeline && !resource.error ? <Skeleton rows={4} height={72} /> : null}
        {pipeline ? (
          <>
            <div class="sp-factbar">
              <StatusBadge status={pipeline.status} />
              <span class="sp-mono">{pipeline.ref}</span>
              <A href={`/projects/${project}/-/commit/${pipeline.sha}`} class="sp-mono">
                {shortSha(pipeline.sha)}
              </A>
              <span>{pipeline.source}</span>
              <span>{pipeline.actor}</span>
              <Time iso={pipeline.created_at} />
              {canRun ? (
                <div class="sp-factbar__actions">
                  {retryable ? (
                    <ActionButton {...buttons} run={() => api.post(`/api/pipelines/${id}/retry`)}>
                      Retry pipeline
                    </ActionButton>
                  ) : null}
                  {!PIPELINE_FINISHED.has(pipeline.status) ? (
                    <ActionButton {...buttons} run={() => api.post(`/api/pipelines/${id}/cancel`)}>
                      Cancel pipeline
                    </ActionButton>
                  ) : null}
                </div>
              ) : null}
            </div>
            {pipeline.errors.length > 0 ? (
              <Notice>
                <ul class="sp-ci-errors">
                  {pipeline.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {pipeline.stages.length > 0 ? <StageCards stages={pipeline.stages} /> : null}
            {pipeline.jobs.length > 0 ? (
              <>
                <PipelineGraph project={project} jobs={pipeline.jobs} />
                <JobRows project={project} jobs={jobs} buttons={buttons} />
              </>
            ) : (
              <p class="sp-muted">This pipeline has no jobs.</p>
            )}
          </>
        ) : null}
      </div>
    </Page>
  );
}

/** Jobs in stage order, attempts of one job together. */
function orderJobs(pipeline: PipelineDetail): PipelineDetail["jobs"] {
  const stageOrder = new Map(pipeline.stages.map((stage, index) => [stage.name, index] as const));
  return pipeline.jobs.toSorted((a, b) => (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0) || a.id - b.id);
}


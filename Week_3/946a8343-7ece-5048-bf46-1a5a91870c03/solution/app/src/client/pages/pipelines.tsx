import { api } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { EmptyState, Notice, Page, Skeleton, StatusBadge, Time } from "../ui/index.ts";
import "../styles/ci.css";
import { pipelinePath, shortSha } from "./ci/job-facts.ts";
import type { PipelineSummary } from "./ci/types.ts";

export default function PipelinesPage() {
  const { params, query } = useRoute();
  const project = Number(params.id);
  const ref = query.get("ref");
  const resource = useLiveResource<{ pipelines: PipelineSummary[] }>({
    project,
    types: ["pipeline"],
    load: (signal) => api.get(`/api/projects/${project}/pipelines${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, { signal }),
    deps: [project, ref],
  });
  const pipelines = resource.data?.pipelines;
  return (
    <Page title="Pipelines" project={params.id}>
      <div class="sp-ci-page">
        {resource.error ? <Notice>{resource.error.message}</Notice> : null}
        {!pipelines && !resource.error ? <Skeleton rows={4} height={64} /> : null}
        {pipelines && pipelines.length === 0 ? (
          <EmptyState eyebrow="PIPELINES" headline="No pipelines yet" action={{ label: "Edit pipeline config", href: `/projects/${project}/-/ci/editor` }} />
        ) : null}
        {pipelines && pipelines.length > 0 ? (
          <ul role="list" aria-label="Pipelines" class="sp-rows">
            {pipelines.map((pipeline) => (
              <li key={pipeline.id} class="sp-rows__item">
                <A href={pipelinePath(project, pipeline.id)} class="sp-rows__link">
                  <span class="sp-mono sp-rows__id">{`#${pipeline.id}`}</span>
                  <StatusBadge status={pipeline.status} />
                  <span class="sp-mono">{pipeline.ref}</span>
                  <span class="sp-mono">{shortSha(pipeline.sha)}</span>
                  <span class="sp-muted">{pipeline.source}</span>
                  <span class="sp-muted">{pipeline.actor}</span>
                  <Time iso={pipeline.created_at} />
                </A>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Page>
  );
}

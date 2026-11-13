import { api } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { Chip, EmptyState, Notice, Page, Skeleton, StatusBadge, Time } from "../ui/index.ts";
import "../styles/ci.css";
import type { Environment } from "./ci/types.ts";

function latestNumber(environment: Environment): number {
  return Math.max(0, ...environment.deployments.map((deployment) => deployment.number));
}

function environmentLabel(environment: Environment): string {
  return `Environment ${environment.name}, ${environment.state}, deployment ${latestNumber(environment)}`;
}

export default function EnvironmentsPage() {
  const { params } = useRoute();
  const project = Number(params.id);
  const resource = useLiveResource<{ environments: Environment[] }>({
    project,
    types: ["environment", "deployment"],
    load: (signal) => api.get(`/api/projects/${project}/environments`, { signal }),
    deps: [project],
  });
  const environments = resource.data?.environments;
  return (
    <Page title="Environments" project={params.id}>
      <div class="sp-ci-page">
        {resource.error ? <Notice>{resource.error.message}</Notice> : null}
        {!environments && !resource.error ? <Skeleton rows={3} height={64} /> : null}
        {environments && environments.length === 0 ? (
          <EmptyState eyebrow="ENVIRONMENTS" headline="No environments yet" action={{ label: "Edit pipeline config", href: `/projects/${project}/-/ci/editor` }} />
        ) : null}
        {environments && environments.length > 0 ? (
          <ul role="list" aria-label="Environments" class="sp-rows">
            {environments.map((environment) => (
              <li key={environment.id} class="sp-rows__item" aria-label={environmentLabel(environment)}>
                <A href={`/projects/${project}/-/environments/${environment.id}`} class="sp-rows__link">
                  <span class="sp-mono sp-rows__id">{environment.name}</span>
                  <Chip>{environment.tier}</Chip>
                  <StatusBadge status={environment.state} />
                  <span class="sp-muted">{`Deployment ${latestNumber(environment)}`}</span>
                  {environment.auto_stop_at !== null ? (
                    <span class="sp-muted">
                      Auto-stops at <Time iso={environment.auto_stop_at} />
                    </span>
                  ) : null}
                </A>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Page>
  );
}

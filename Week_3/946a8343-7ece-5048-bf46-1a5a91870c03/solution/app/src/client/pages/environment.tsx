import { useState } from "preact/hooks";
import { api, type ApiError } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { useRoute } from "../router.ts";
import { Chip, Notice, Page, Skeleton, StatusBadge, Time } from "../ui/index.ts";
import "../styles/ci.css";
import { ActionButton } from "./ci/action-button.tsx";
import { DeploymentCard } from "./ci/deployment-card.tsx";
import type { Environment } from "./ci/types.ts";

/** The deployment the environment runs now: the newest one that succeeded. */
function currentNumber(environment: Environment): number | null {
  const shipped = environment.deployments.filter((deployment) => deployment.status === "success");
  return shipped.length === 0 ? null : Math.max(...shipped.map((deployment) => deployment.number));
}

export default function EnvironmentPage() {
  const { params } = useRoute();
  const project = Number(params.id);
  const id = Number(params.environment);
  const { atLeast, can } = useRole();
  const [failure, setFailure] = useState<ApiError | null>(null);
  const resource = useLiveResource<Environment>({
    project,
    types: ["environment", "deployment"],
    load: (signal) => api.get<Environment>(`/api/projects/${project}/environments/${id}`, { signal }),
    deps: [project, id],
    match: (message) => message.data.environment_id === id,
  });
  const environment = resource.data;
  const canManage = atLeast("maintainer") || can("manage_environments");
  const common = { onFailure: setFailure, onDone: () => void resource.reload() };
  const current = environment ? currentNumber(environment) : null;

  return (
    <Page title={environment?.name ?? "Environment"} project={params.id} pageKeys={[`env:${id}`]} live>
      <div class="sp-ci-page">
        {resource.error && !environment ? <Notice>{resource.error.message}</Notice> : null}
        {failure ? <Notice>{failure.message}</Notice> : null}
        {!environment && !resource.error ? <Skeleton rows={3} height={72} /> : null}
        {environment ? (
          <>
            <div class="sp-factbar">
              <Chip>{environment.tier}</Chip>
              <StatusBadge status={environment.state} />
              {environment.auto_stop_at !== null ? (
                <span>
                  Auto-stops at <Time iso={environment.auto_stop_at} />
                </span>
              ) : null}
              {canManage ? (
                <div class="sp-factbar__actions">
                  {environment.state === "available" ? (
                    <ActionButton {...common} run={() => api.post(`/api/environments/${id}/stop`)}>
                      Stop environment
                    </ActionButton>
                  ) : null}
                  {environment.auto_stop_at !== null ? (
                    <ActionButton {...common} run={() => api.post(`/api/environments/${id}/keep`)}>
                      Keep environment
                    </ActionButton>
                  ) : null}
                </div>
              ) : null}
            </div>
            {environment.deployments.length === 0 ? <p class="sp-muted">No deployments yet.</p> : null}
            <ul role="list" aria-label="Deployments" class="sp-deployments">
              {environment.deployments.map((deployment) => (
                <DeploymentCard
                  key={deployment.id}
                  project={project}
                  deployment={deployment}
                  rollbackable={canManage && deployment.number !== current && (deployment.status === "success" || deployment.status === "rolled_back")}
                  onRollback={() => api.post(`/api/environments/${id}/rollback`, { deployment: deployment.number })}
                  {...common}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Page>
  );
}

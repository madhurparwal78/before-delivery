// One deployment of an environment: its status, approvals and the buttons its state allows.
import { api, idempotencyKey, type ApiError } from "../../api.ts";
import { A } from "../../router.ts";
import { StatusBadge, Time } from "../../ui/index.ts";
import { ActionButton } from "./action-button.tsx";
import { pipelinePath, shortSha } from "./job-facts.ts";
import type { Deployment } from "./types.ts";

export function DeploymentCard({
  project,
  deployment,
  rollbackable,
  onRollback,
  onFailure,
  onDone,
}: {
  project: number;
  deployment: Deployment;
  /** Set when the viewer may roll back to this deployment. */
  rollbackable: boolean;
  onRollback(): Promise<unknown>;
  onFailure(error: ApiError | null): void;
  onDone(): void;
}) {
  const common = { onFailure, onDone };
  const decide = (status: "approved" | "rejected") =>
    api.post(`/api/projects/${project}/deployments/${deployment.id}/approvals`, { status }, { idempotencyKey: idempotencyKey() });
  return (
    <li class="sp-deployment" data-number={deployment.number} data-status={deployment.status}>
      <div class="sp-deployment__head">
        <span class="sp-deployment__number">{`Deployment ${deployment.number}`}</span>
        <StatusBadge status={deployment.status} />
        <span class="sp-mono">{shortSha(deployment.sha)}</span>
        {deployment.pipeline_id !== null ? <A href={pipelinePath(project, deployment.pipeline_id)}>{`Pipeline ${deployment.pipeline_id}`}</A> : null}
        <span class="sp-muted">{deployment.deployer}</span>
        <Time iso={deployment.created_at} />
      </div>
      {deployment.status === "awaiting_approval" ? (
        <div class="sp-deployment__gate">
          <p class="sp-deployment__waiting">{`Waiting for approval: ${deployment.approved} of ${deployment.required}`}</p>
          <div class="sp-deployment__actions">
            <ActionButton {...common} run={() => decide("approved")} variant="primary">
              Approve deployment
            </ActionButton>
            <ActionButton {...common} run={() => decide("rejected")}>
              Reject deployment
            </ActionButton>
          </div>
        </div>
      ) : null}
      {deployment.approvals.length > 0 ? (
        <ul role="list" class="sp-deployment__approvals">
          {deployment.approvals.map((approval, index) => (
            <li key={index}>
              <span>{`${approval.user} ${approval.status}`}</span>
              {approval.expired ? <span class="sp-deployment__expired">This approval expired.</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {rollbackable ? (
        <div class="sp-deployment__actions">
          <ActionButton {...common} run={onRollback}>{`Roll back to deployment ${deployment.number}`}</ActionButton>
        </div>
      ) : null}
    </li>
  );
}

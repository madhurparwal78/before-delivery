// CI module: pipeline config and lint, pipelines, the simulated runner, jobs, logs, artifacts, caches, reports,
// environments, deployments, rollback and delivery metrics. This file is the module's public surface.
import type { Router } from "../http.ts";
import { onDue } from "../deadlines.ts";
import { lapseApprovals, stopDueEnvironments } from "./deployments.ts";
import { expireArtifacts } from "./expiry.ts";
import { registerCiHttp } from "./routes.ts";
import { registerRound } from "./scheduler.ts";

export function registerCiRoutes(router: Router): void {
  registerCiHttp(router);
  registerRound();
  onDue(expireArtifacts);
  onDue(lapseApprovals);
  onDue(stopDueEnvironments);
}

export type { PipelineBrief } from "./pipelines.ts";
export {
  cancelPipeline, createPipeline, failPipelineForTimeout, getPipelineBrief, latestPipelineOnCommit, onBranchPushed,
} from "./pipelines.ts";

export { blockingFindingCount, reportsForRequest } from "./request-reports.ts";

export { seedPipelines, seedProtectedEnvironments } from "./seed.ts";
export { runRounds, settle } from "./scheduler.ts";

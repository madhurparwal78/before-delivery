// Planning module: issues, labels, quick actions, epics, milestones, boards, wiki and search.
import type { Router } from "../http.ts";
import { registerBoardRoutes } from "./boards.ts";
import { registerEpicRoutes } from "./epics.ts";
import { registerIssueRoutes } from "./issues.ts";
import { registerLabelRoutes } from "./labels.ts";
import { registerMilestoneRoutes } from "./milestones.ts";
import { registerSearchRoutes } from "./search.ts";
import { registerWikiRoutes } from "./wiki.ts";

export function registerPlanningRoutes(router: Router): void {
  registerLabelRoutes(router);
  registerIssueRoutes(router);
  registerMilestoneRoutes(router);
  registerEpicRoutes(router);
  registerBoardRoutes(router);
  registerWikiRoutes(router);
  registerSearchRoutes(router);
}

export { closeIssuesForMerge, createIssue, openIssueCount, readableIssueIids } from "./issues.ts";
export { seedEpics, seedGroupLabels, seedProjectPlanning } from "./seed.ts";

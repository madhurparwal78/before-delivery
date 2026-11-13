// Admin module: groups, projects, members, custom roles, settings and protection API, webhooks, export and import,
// audit API, grading routes and the demo seed.
import type { Router } from "../http.ts";
import { registerAuditRoutes } from "./audit-api.ts";
import { registerGradingRoutes } from "./grading.ts";
import { registerGroupRoutes } from "./groups.ts";
import { registerMemberRoutes } from "./members.ts";
import { registerOverviewRoutes } from "./overview.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerTransferRoutes } from "./transfer.ts";
import { registerWebhookRoutes } from "./webhooks.ts";

export function registerAdminRoutes(router: Router): void {
  registerGroupRoutes(router);
  registerMemberRoutes(router);
  registerProjectRoutes(router);
  registerOverviewRoutes(router);
  registerAuditRoutes(router);
  registerWebhookRoutes(router);
  registerTransferRoutes(router);
  registerGradingRoutes(router);
}

export { dispatchPushWebhook, dispatchWebhook } from "./webhooks.ts";
export type { WebhookEvent } from "./rules.ts";

export { seedDemoInstance } from "./demo.ts";

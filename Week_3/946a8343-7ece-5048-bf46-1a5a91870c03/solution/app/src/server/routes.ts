import { Router } from "./http.ts";
import { registerAccountRoutes } from "./accounts.ts";
import { registerRepoRoutes } from "./repo/index.ts";
import { registerMrRoutes } from "./mr/index.ts";
import { registerCiRoutes } from "./ci/index.ts";
import { registerTrainRoutes } from "./train/index.ts";
import { registerPlanningRoutes } from "./planning/index.ts";
import { registerAdminRoutes } from "./admin/index.ts";

export function buildRouter(): Router {
  const router = new Router();
  registerAccountRoutes(router);
  registerAdminRoutes(router);
  registerRepoRoutes(router);
  registerMrRoutes(router);
  registerCiRoutes(router);
  registerTrainRoutes(router);
  registerPlanningRoutes(router);
  return router;
}

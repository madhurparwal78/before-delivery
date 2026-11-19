import { buildServer } from "./app.js";
import { registerDeskRoutes } from "./api/desk.js";
import { registerLabelRoutes } from "./api/labels.js";
import { registerStyleRoutes } from "./api/styles.js";
import { registerRequestRoutes } from "./api/requests.js";
import { registerAnswerRoutes } from "./api/answers.js";
import { registerVisitRoutes } from "./api/visits.js";
import { registerResultRoutes } from "./api/results.js";
import { registerPassportRoutes, registerDossierRoutes } from "./api/passports.js";
import { registerEstimateRoute } from "./api/estimate.js";
import { registerPageRoutes } from "./pages.js";
import { startHousekeeping } from "./housekeeping.js";
import type { FastifyInstance } from "fastify";

async function main(): Promise<void> {
  const app = await buildServer();
  registerDeskRoutes(app);
  registerLabelRoutes(app);
  registerStyleRoutes(app);
  registerRequestRoutes(app);
  registerAnswerRoutes(app);
  registerVisitRoutes(app);
  registerResultRoutes(app);
  registerPassportRoutes(app);
  registerDossierRoutes(app);
  registerEstimateRoute(app);
  registerPageRoutes(app);
  startHousekeeping(app);

  const port = app.state.config.appPublicPort;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Fio Contado Desk serving on 0.0.0.0:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export type { FastifyInstance };

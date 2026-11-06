import type { Router } from "express";
import type { Services } from "./services.js";
import type { AppConfig } from "./config.js";
import { wrapRouter } from "./web.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerEssayRoutes } from "./routes/essays.js";
import { registerSocialRoutes } from "./routes/social.js";
import { registerLicenceRoutes } from "./routes/licences.js";
import { registerDeskRoutes } from "./routes/desk.js";
import { registerTreasurerRoutes } from "./routes/treasurer.js";
import { registerMediaRoutes } from "./routes/media.js";

export function registerRoutes(app: Router, services: Services, config: AppConfig): void {
  const router = wrapRouter(app);
  registerSessionRoutes(router, services, config);
  registerEssayRoutes(router, services);
  registerSocialRoutes(router, services);
  registerLicenceRoutes(router, services);
  registerDeskRoutes(router, services);
  registerTreasurerRoutes(router, services);
  registerMediaRoutes(router, services);
}

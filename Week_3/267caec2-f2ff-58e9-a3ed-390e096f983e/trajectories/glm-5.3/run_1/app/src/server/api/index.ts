import type { App } from "../app.js";
import { registerAccountRoutes } from "./accounts.js";
import { registerProgramRoutes } from "./programs.js";
import { registerEntryRoutes } from "./entries.js";
import { registerDirectorRoutes } from "./director.js";
import { registerJurorRoutes } from "./juror.js";
import { registerPublicRoutes } from "./public.js";

export function registerRoutes(app: App): void {
  registerAccountRoutes(app);
  registerProgramRoutes(app);
  registerEntryRoutes(app);
  registerDirectorRoutes(app);
  registerJurorRoutes(app);
  registerPublicRoutes(app);
}

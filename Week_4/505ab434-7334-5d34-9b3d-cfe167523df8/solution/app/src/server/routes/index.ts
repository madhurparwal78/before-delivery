import type { Router } from "../http.ts";
import { registerAssets } from "./assets.ts";
import { registerAudit } from "./audit.ts";
import { registerChapters } from "./chapters.ts";
import { registerCore } from "./core.ts";
import { registerGrants } from "./grants.ts";
import { registerLibrary } from "./library.ts";
import { registerPeople } from "./people.ts";
import { registerRequests } from "./requests.ts";

export function registerRoutes(router: Router): void {
  registerCore(router);
  registerRequests(router);
  registerGrants(router);
  registerAudit(router);
  registerLibrary(router);
  registerAssets(router);
  registerChapters(router);
  registerPeople(router);
}

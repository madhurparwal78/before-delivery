import { Earshot } from "./main.js";
import { Router } from "./http-core.js";

/** Shared route registration context. */
export interface Context {
  app: Earshot;
  router: Router;
}

export type { Earshot };

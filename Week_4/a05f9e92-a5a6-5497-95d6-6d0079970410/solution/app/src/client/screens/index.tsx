import type { RouteDef } from "../lib/router.js";
import { dataRoutes } from "./data/routes.js";
import { deskRoutes } from "./desk/routes.js";
import { designRoutes } from "./design/routes.js";
import { mapRoutes } from "./map/routes.js";
import { portalRoutes } from "./portal/routes.js";
import { recordRoutes } from "./record/routes.js";
import { votesRoutes } from "./votes/routes.js";

/** Every screen below the landing and sign-in pages; each area owns one routes file. */
export const screens: RouteDef[] = [...deskRoutes, ...recordRoutes, ...portalRoutes, ...votesRoutes, ...dataRoutes, ...mapRoutes, ...designRoutes];

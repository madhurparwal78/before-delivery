import type { Route } from "./http";
import { defineRoute, reply } from "./http";
import { authRoutes } from "./auth";
import { limits } from "./config";
import { fileRoutes } from "./files";
import { gradingRoutes } from "./grading";
import { importRoutes } from "./imports";
import { recipeRoutes } from "./recipes";
import { snapshotRoutes } from "./snapshots";
import { storageReachable } from "./storage";
import { teamRoutes } from "./teams";

const serviceRoutes: Route[] = [
  defineRoute({
    method: "GET", path: "/api/health", access: "public",
    run: async () => reply(200, { status: (await storageReachable()) ? "ok" : "unavailable" }),
  }),
  defineRoute({ method: "GET", path: "/api/config", access: "public", run: async () => reply(200, limits) }),
];

export const routes: Route[] = [
  ...serviceRoutes, ...authRoutes, ...recipeRoutes, ...fileRoutes, ...snapshotRoutes, ...importRoutes, ...teamRoutes, ...gradingRoutes,
];

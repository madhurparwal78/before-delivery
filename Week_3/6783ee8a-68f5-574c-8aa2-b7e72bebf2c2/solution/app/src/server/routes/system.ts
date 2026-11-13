import { limits } from "../config";
import { defineRoute, reply } from "../http";
import { storageReachable } from "../storage";
import { ready } from "../state";

export const systemRoutes = [
  defineRoute({
    method: "GET",
    path: "/api/health",
    access: "public",
    run: async () => {
      if (!ready()) return reply(503, { status: "starting" });
      return reply(200, { status: (await storageReachable()) ? "ok" : "unavailable" });
    },
  }),
  defineRoute({ method: "GET", path: "/api/config", access: "public", run: async () => reply(200, limits) }),
];

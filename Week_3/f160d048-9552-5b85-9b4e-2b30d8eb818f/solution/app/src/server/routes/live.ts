import { defineRoute, type Handler } from "../http/route";
import { openStream } from "../services/liveHub";

const live = defineRoute({
  method: "GET",
  path: "/api/live",
  auth: "public",
  async run(ctx) {
    await openStream(ctx.req, ctx.res, ctx.viewer);
    return { status: 200 };
  },
});

export const liveRoutes: Handler[] = [live];

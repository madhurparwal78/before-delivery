import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serviceStatus } from "../health.js";
import { subscribe } from "../live.js";
import { requireActor } from "./context.js";

export const liveRoutes = new Hono();

liveRoutes.get("/", async (c) => {
  const actor = await requireActor(c);
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribe((event) => {
      const mine =
        event.type === "services" ||
        (event.type === "role" && event.userId === actor.id) ||
        ((event.type === "document" || event.type === "templates") && event.teamId === actor.teamId);
      if (mine) void stream.writeSSE({ data: JSON.stringify(event) });
    });
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ data: JSON.stringify({ type: "services", ...serviceStatus() }) });
    while (!stream.aborted) {
      await stream.sleep(15000);
      await stream.write(": keep-alive\n\n");
    }
  });
});

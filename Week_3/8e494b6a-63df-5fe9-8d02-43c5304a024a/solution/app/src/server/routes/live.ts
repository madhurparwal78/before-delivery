// GET /api/events: the space's live messages as a server-sent stream, replaying what a late connection missed.
import { authorize } from "../access";
import { openStream, route, STREAMED } from "../http";
import { replaySince, subscribe } from "../live";

route("GET", "/api/events", "none", async (ctx) => {
  const access = await authorize(ctx);
  const header = ctx.req.headers["last-event-id"];
  const since = Number(typeof header === "string" ? header : (ctx.query.get("since") ?? Number.NaN));
  const events = openStream(ctx);
  const send = (message: { seq: number; type: string; data: unknown }): void => events.send(message.type, message.data, message.seq);
  if (Number.isFinite(since)) for (const message of replaySince(access.space.id, since)) send(message);
  events.onClose(subscribe(access.space.id, send));
  return STREAMED;
});

import { database, one, pool } from "../db.js";
import { partyEvent } from "../publish.js";
import { reply, route } from "../http.js";
import { subscribe, sendToOne } from "../live.js";
import { storageReachable } from "../storage.js";
import { invitesOf, playerView, questView, taskLists } from "../views.js";
import { latestQuestOf } from "../domain/quests.js";
import type { PartyRow } from "../records.js";

route("GET", "/api/health", async () => {
  if (!database.ready) return reply(503, { status: "starting" });
  return reply(200, { status: (await storageReachable()) ? "ok" : "unavailable" });
});

route("GET", "/api/live", async (context) => {
  const user = await context.user();
  context.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  subscribe(user.id, context.res);
  sendToOne(context.res, { name: "player", data: await playerView(pool, user) });
  sendToOne(context.res, { name: "tasks", data: await taskLists(pool, user) });
  sendToOne(context.res, { name: "invite", data: { invites: await invitesOf(pool, user.id) } });
  sendToOne(context.res, await partyEvent(user));
  const party = user.party_id ? await one<PartyRow>(pool, "SELECT * FROM parties WHERE id = $1", [user.party_id]) : undefined;
  const quest = party ? await latestQuestOf(pool, party.id) : undefined;
  if (quest) sendToOne(context.res, { name: "quest", data: await questView(pool, quest) });
  return { status: 200, streamed: true };
});

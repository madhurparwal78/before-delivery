import { memberParty, memberQuest, requireLeader, visibleQuest } from "../access.js";
import { one, pool, rows } from "../db.js";
import { loadUser } from "../domain/progress.js";
import { MIN_ACCEPTED_TO_BEGIN } from "../../shared/api.js";
import { FIXTURES, FINISHED_STATES, LIVE_STATES, fixtureNamed, fixtureView, moveQuest, requireLiveInvite, requireMove } from "../domain/quests.js";
import { Message, Refusal, invalid } from "../errors.js";
import { reply, route } from "../http.js";
import { mutate } from "../mutate.js";
import type { QuestRow } from "../records.js";
import { questView } from "../views.js";
import { asObject } from "./auth.js";

route("GET", "/api/quest-fixtures", async (context) => {
  await context.user();
  return reply(200, { quests: FIXTURES.map(fixtureView) });
});

route("POST", "/api/parties/:id/quests", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const party = await memberParty(db, user, context.params.id!);
    requireLeader(party, user);
    if (await one(db, "SELECT 1 FROM quests WHERE party_id = $1 AND state = ANY($2)", [party.id, LIVE_STATES])) throw Refusal.questInProgress();
    const fixture = fixtureNamed(context.json((body) => String(asObject(body).quest)));
    if (!fixture) throw invalid({ quest: Message.quest });
    const quest = (await one<QuestRow>(
      db,
      "INSERT INTO quests (party_id, name, state, boss_health_tenths, invited_at) VALUES ($1, $2, 'invited', $3, now()) RETURNING *",
      [party.id, fixture.name, fixture.maxHealthTenths],
    ))!;
    await db.query("INSERT INTO quest_responses (quest_id, user_id, accepted) VALUES ($1, $2, true)", [quest.id, user.id]);
    touch.quest(quest.id);
    touch.party(party.id);
    return reply(201, await questView(db, quest));
  });
});

route("GET", "/api/quests/:id", async (context) => {
  const user = await context.user();
  return reply(200, await questView(pool, await visibleQuest(pool, user, context.params.id!)));
});

function respond(move: "accept" | "decline"): void {
  route("POST", `/api/quests/:id/${move}`, async (context) => {
    const account = await context.user();
    return mutate(async (db, touch) => {
      const user = await loadUser(db, account.id);
      const quest = await memberQuest(db, user, context.params.id!);
      requireMove(quest, move);
      if (move === "accept") requireLiveInvite(quest, new Date());
      await db.query(
        `INSERT INTO quest_responses (quest_id, user_id, accepted) VALUES ($1, $2, $3)
         ON CONFLICT (quest_id, user_id) DO UPDATE SET accepted = $3, responded_at = now()`,
        [quest.id, user.id, move === "accept"],
      );
      touch.quest(quest.id);
      return reply(200, await questView(db, quest));
    });
  });
}

respond("accept");
respond("decline");

route("POST", "/api/quests/:id/begin", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const quest = await memberQuest(db, user, context.params.id!);
    requireLeader((await memberParty(db, user, quest.party_id)), user);
    requireMove(quest, "begin");
    const now = new Date();
    requireLiveInvite(quest, now);
    if ((await questView(db, quest)).acceptedBy.length < MIN_ACCEPTED_TO_BEGIN) throw Refusal.notEnoughAccepted();
    return reply(200, await questView(db, await moveQuest(db, touch, quest, "begin", now)));
  });
});

route("POST", "/api/quests/:id/abandon", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const quest = await memberQuest(db, user, context.params.id!);
    requireLeader(await memberParty(db, user, quest.party_id), user);
    requireMove(quest, "abandon");
    return reply(200, await questView(db, await moveQuest(db, touch, quest, "abandon", new Date())));
  });
});

route("GET", "/api/history", async (context) => {
  const user = await context.user();
  const finished = await rows<QuestRow>(
    pool,
    `SELECT q.* FROM quests q JOIN quest_participants p ON p.quest_id = q.id
     WHERE p.user_id = $1 AND q.state = ANY($2) ORDER BY q.ended_at DESC, q.seq DESC`,
    [user.id, FINISHED_STATES],
  );
  return reply(200, { quests: await Promise.all(finished.map((quest) => questView(pool, quest))) });
});

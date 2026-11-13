import { query, transaction } from '../db.js';
import { config } from '../config.js';
import { Router, type Ctx } from '../http/core.js';
import { VALIDATION_MESSAGES, fail, failValidation } from '../http/errors.js';
import { MIN_ACCEPTED_TO_BEGIN, QUEST_FIXTURES, canMove, questFixture } from '../domain/quests.js';
import { isMember, liveQuestId, memberIds } from '../services/party.js';
import { loadUser, type UserRow } from '../services/player.js';
import { publishChat, publishParty, publishQuest } from '../services/notify.js';
import { addParticipants, expiresAtOf, loadQuest, questJson } from '../services/quest.js';
import { requireLeader, requireMembership } from './party.js';

async function currentUser(ctx: Ctx): Promise<UserRow> {
  const session = ctx.requireUser();
  const user = await loadUser({ query }, session.id);
  if (!user) throw fail('unauthenticated');
  return user;
}

/** A quest is visible to the party's current members and to the Players who were in it when it finished. */
async function visibleQuest(questId: string, userId: string) {
  const quest = await loadQuest({ query }, questId);
  if (!quest) throw fail('not_found');
  if (await isMember({ query }, quest.party_id, userId)) return quest;
  const participant = await query('select 1 from quest_participants where quest_id = $1 and user_id = $2', [
    questId,
    userId,
  ]);
  if (participant.rowCount === 1 && (quest.state === 'defeated' || quest.state === 'abandoned')) return quest;
  throw fail('not_found');
}

export function registerQuestRoutes(router: Router): void {
  router.add('GET', '/api/quest-fixtures', (ctx) => {
    ctx.requireUser();
    ctx.send(200, {
      quests: QUEST_FIXTURES.map((fixture) => ({
        name: fixture.name,
        boss: fixture.boss,
        maxHealth: fixture.maxHealth,
        power: fixture.power,
        rewardGold: fixture.rewardGold,
        rewardExperience: fixture.rewardExperience,
      })),
    });
  });

  router.add('POST', '/api/parties/:id/quests', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireLeader({ query }, partyId, user.id);
    if (await liveQuestId({ query }, partyId)) throw fail('quest_in_progress');
    const body = ctx.json();
    const fixture = typeof body.quest === 'string' ? questFixture(body.quest) : undefined;
    if (!fixture) throw failValidation({ quest: VALIDATION_MESSAGES.quest });

    const questId = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into quests (party_id, name, boss, max_health_tenths, boss_health_tenths, power_tenths,
           reward_gold_cents, reward_experience, state)
         values ($1, $2, $3, $4, $4, $5, $6, $7, 'invited') returning id`,
        [
          partyId,
          fixture.name,
          fixture.boss,
          fixture.maxHealthTenths,
          fixture.powerTenths,
          fixture.rewardGoldCents,
          fixture.rewardExperience,
        ],
      );
      const id = created.rows[0]?.id as string;
      await client.query('insert into quest_responses (quest_id, user_id, accepted) values ($1, $2, true)', [
        id,
        user.id,
      ]);
      await addParticipants(client, id, await memberIds(client, partyId));
      return id;
    });
    await publishQuest({ query }, questId);
    await publishParty({ query }, partyId);
    ctx.send(201, await questJson({ query }, questId));
  });

  router.add('GET', '/api/quests/:id', async (ctx) => {
    const user = await currentUser(ctx);
    const quest = await visibleQuest(ctx.param('id'), user.id);
    ctx.send(200, await questJson({ query }, quest.id));
  });

  router.add('POST', '/api/quests/:id/accept', async (ctx) => {
    const user = await currentUser(ctx);
    const quest = await visibleQuest(ctx.param('id'), user.id);
    await requireMembership({ query }, quest.party_id, user.id);
    if (!canMove(quest.state, 'active')) throw fail('quest_not_active');
    if (Date.now() >= expiresAtOf(quest).getTime()) throw fail('invite_expired');
    await transaction((client) =>
      client.query(
        `insert into quest_responses (quest_id, user_id, accepted) values ($1, $2, true)
         on conflict (quest_id, user_id) do update set accepted = true`,
        [quest.id, user.id],
      ),
    );
    await publishQuest({ query }, quest.id);
    ctx.send(200, await questJson({ query }, quest.id));
  });

  router.add('POST', '/api/quests/:id/decline', async (ctx) => {
    const user = await currentUser(ctx);
    const quest = await visibleQuest(ctx.param('id'), user.id);
    await requireMembership({ query }, quest.party_id, user.id);
    if (!canMove(quest.state, 'active')) throw fail('quest_not_active');
    await transaction((client) =>
      client.query(
        `insert into quest_responses (quest_id, user_id, accepted) values ($1, $2, false)
         on conflict (quest_id, user_id) do update set accepted = false`,
        [quest.id, user.id],
      ),
    );
    await publishQuest({ query }, quest.id);
    ctx.send(200, await questJson({ query }, quest.id));
  });

  router.add('POST', '/api/quests/:id/begin', async (ctx) => {
    const user = await currentUser(ctx);
    const quest = await visibleQuest(ctx.param('id'), user.id);
    await requireLeader({ query }, quest.party_id, user.id);
    if (!canMove(quest.state, 'active')) throw fail('quest_not_active');
    if (Date.now() >= expiresAtOf(quest).getTime()) throw fail('invite_expired');
    const accepted = await query<{ total: string }>(
      'select count(*)::text as total from quest_responses where quest_id = $1 and accepted = true',
      [quest.id],
    );
    if (Number(accepted.rows[0]?.total ?? '0') < MIN_ACCEPTED_TO_BEGIN) throw fail('not_enough_accepted');

    await transaction(async (client) => {
      await client.query(`update quests set state = 'active', started_at = now() where id = $1`, [quest.id]);
      await addParticipants(client, quest.id, await memberIds(client, quest.party_id));
    });
    await publishQuest({ query }, quest.id);
    await publishParty({ query }, quest.party_id);
    ctx.send(200, await questJson({ query }, quest.id));
  });

  router.add('POST', '/api/quests/:id/abandon', async (ctx) => {
    const user = await currentUser(ctx);
    const quest = await visibleQuest(ctx.param('id'), user.id);
    await requireLeader({ query }, quest.party_id, user.id);
    if (!canMove(quest.state, 'abandoned')) throw fail('quest_not_active');
    await transaction(async (client) => {
      await client.query(`update quests set state = 'abandoned', ended_at = now() where id = $1`, [quest.id]);
      await addParticipants(client, quest.id, await memberIds(client, quest.party_id));
    });
    await publishQuest({ query }, quest.id);
    await publishParty({ query }, quest.party_id);
    ctx.send(200, await questJson({ query }, quest.id));
  });

  router.add('POST', '/api/parties/:id/chat', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireMembership({ query }, partyId, user.id);
    const recent = await query<{ total: string }>(
      `select count(*)::text as total from chat_messages
       where user_id = $1 and created_at > now() - interval '60 seconds'`,
      [user.id],
    );
    if (Number(recent.rows[0]?.total ?? '0') >= config.chatMaxPerMinute) throw fail('chat_rate_limited');
    const body = ctx.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > 500) throw failValidation({ text: VALIDATION_MESSAGES.text });

    const message = await transaction(async (client) => {
      const created = await client.query<{ id: string; created_at: Date }>(
        'insert into chat_messages (party_id, user_id, text) values ($1, $2, $3) returning id, created_at',
        [partyId, user.id, text],
      );
      const row = created.rows[0];
      if (!row) throw fail('not_found');
      return { id: row.id, username: user.username, text, createdAt: row.created_at.toISOString() };
    });
    await publishChat({ query }, partyId, message);
    ctx.send(201, message);
  });

  router.add('GET', '/api/history', async (ctx) => {
    const user = await currentUser(ctx);
    const found = await query<{ id: string }>(
      `select q.id from quests q join quest_participants p on p.quest_id = q.id
       where q.state in ('defeated', 'abandoned') and p.user_id = $1
       order by q.ended_at desc`,
      [user.id],
    );
    const quests = [];
    for (const row of found.rows) {
      const quest = await questJson({ query }, row.id);
      if (quest) quests.push(quest);
    }
    ctx.send(200, { quests });
  });
}

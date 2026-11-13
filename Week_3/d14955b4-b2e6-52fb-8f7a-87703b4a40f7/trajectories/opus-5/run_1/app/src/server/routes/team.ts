import { config } from '../config';
import { one, query } from '../db';
import { forbidden, notFound, validation } from '../errors';
import { FIELD } from '../../shared/copy';
import { loadRules, requireChangeToken, requireSession } from '../auth';
import { publish } from '../bus';
import { decide } from '../domain/permissions';
import { newId } from '../ids';
import { sendEmpty, sendJson, type Router } from '../http';
import { readJsonBody } from './body';
import {
  RULE_ACTIONS,
  TOPICS,
  type EffectiveEntry,
  type Moderator,
  type Rule,
  type RuleAction,
  type RuleEffect,
  type RuleTopic,
} from '../../shared/types';

const RULE_TOPICS: RuleTopic[] = [...TOPICS, '*'];
const SECRET_PATTERN = /^[\u0021-\u007e]{16,128}$/;

async function requireModerator(gameId: string, moderatorId: string): Promise<{ id: string; name: string }> {
  const row = await one<{ id: string; name: string }>(
    `SELECT id, name FROM staff WHERE id = $1 AND game_id = $2 AND role = 'moderator'`,
    [moderatorId, gameId],
  );
  if (!row) throw notFound();
  return row;
}

export function registerTeamRoutes(router: Router): void {
  router.add('GET', '/api/team', async (ctx) => {
    const session = await requireSession(ctx);
    if (session.caller.role !== 'developer') throw forbidden();
    const staff = await query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM staff WHERE game_id = $1 AND role = 'moderator' ORDER BY name ASC`,
      [session.caller.gameId],
    );
    const moderators: Moderator[] = [];
    for (const row of staff.rows) {
      moderators.push({ id: row.id, name: row.name, email: row.email, rules: await loadRules(row.id) });
    }
    sendJson(ctx, 200, { moderators });
  });

  router.add('POST', '/api/team/:id/rules', async (ctx) => {
    const payload = await readJsonBody(ctx);
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    if (session.caller.role !== 'developer') throw forbidden();
    const moderator = await requireModerator(session.caller.gameId, ctx.params.id as string);
    const fields: Record<string, string> = {};
    const effect = payload.effect;
    if (effect !== 'grant' && effect !== 'deny') fields.effect = FIELD.effect;
    const action = payload.action;
    if (typeof action !== 'string' || !RULE_ACTIONS.includes(action as RuleAction)) {
      fields.action = FIELD.action;
    }
    const topic = payload.topic;
    if (typeof topic !== 'string' || !RULE_TOPICS.includes(topic as RuleTopic)) {
      fields.topic = FIELD.ruleTopic;
    }
    if (Object.keys(fields).length > 0) throw validation(fields);

    const existing = await one<Rule>(
      `SELECT id, effect, action, topic FROM rules
        WHERE moderator_id = $1 AND effect = $2 AND action = $3 AND topic = $4`,
      [moderator.id, effect, action, topic],
    );
    if (existing) {
      sendJson(ctx, 200, { rule: existing });
      return;
    }
    const rule: Rule = {
      id: newId('rule'),
      effect: effect as RuleEffect,
      action: action as RuleAction,
      topic: topic as RuleTopic,
    };
    await query(`INSERT INTO rules (id, moderator_id, effect, action, topic) VALUES ($1, $2, $3, $4, $5)`, [
      rule.id,
      moderator.id,
      rule.effect,
      rule.action,
      rule.topic,
    ]);
    publish({ kind: 'rules', gameId: session.caller.gameId, moderatorId: moderator.id });
    sendJson(ctx, 201, { rule });
  });

  router.add('DELETE', '/api/team/:id/rules/:ruleId', async (ctx) => {
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    if (session.caller.role !== 'developer') throw forbidden();
    const moderator = await requireModerator(session.caller.gameId, ctx.params.id as string);
    const removed = await one<{ id: string }>(
      `DELETE FROM rules WHERE id = $1 AND moderator_id = $2 RETURNING id`,
      [ctx.params.ruleId as string, moderator.id],
    );
    if (!removed) throw notFound();
    publish({ kind: 'rules', gameId: session.caller.gameId, moderatorId: moderator.id });
    sendEmpty(ctx, 204);
  });

  router.add('GET', '/api/team/:id/effective', async (ctx) => {
    const session = await requireSession(ctx);
    if (session.caller.role !== 'developer') throw forbidden();
    const moderator = await requireModerator(session.caller.gameId, ctx.params.id as string);
    const rules = await loadRules(moderator.id);
    const effective: EffectiveEntry[] = [];
    for (const action of RULE_ACTIONS) {
      for (const topic of TOPICS) {
        const decision = decide(rules, action, topic);
        effective.push({ action, topic, allowed: decision.allowed, decided_by: decision.decidedBy });
      }
    }
    sendJson(ctx, 200, { effective });
  });

  router.add('PUT', '/api/game/server-secret', async (ctx) => {
    const payload = await readJsonBody(ctx);
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    if (session.caller.role !== 'developer') throw forbidden();
    const secret = payload.secret;
    if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) {
      throw validation({ secret: FIELD.secret });
    }
    const row = await one<{ previous_valid_until: Date }>(
      `UPDATE games SET previous_server_secret = server_secret,
          previous_valid_until = now() + ($2 || ' seconds')::interval,
          server_secret = $3
        WHERE id = $1 RETURNING previous_valid_until`,
      [session.caller.gameId, String(config.secretOverlapSeconds), secret],
    );
    sendJson(ctx, 200, { previous_valid_until: row?.previous_valid_until.toISOString() ?? null });
  });
}

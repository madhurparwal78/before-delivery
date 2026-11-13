import { ACTIONS, TOPICS } from '../../shared/types.js';
import type { RuleAction, RuleBody, RuleEffect, RuleTopic, TeamBody } from '../../shared/types.js';
import { requireDeveloper, staffAccess } from '../access.js';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { effectiveEntries, loadRules } from '../permissions.js';
import { notFound, route, validation } from '../http.js';
import { publish } from '../hub.js';
import { newId } from '../ids.js';

const SECRET_FORMAT = /^[\x21-\x7e]{16,128}$/;

async function moderatorOf(gameId: string, moderatorId: string): Promise<{ id: string; name: string; email: string }> {
  const { rows } = await pool.query<{ id: string; name: string; email: string }>(
    `select id, name, email from staff where id = $1 and game_id = $2 and role = 'moderator'`,
    [moderatorId, gameId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export const teamRoutes = [
  route('GET', '/api/team', async (ctx) => {
    const { staff } = await staffAccess(ctx, { change: false });
    requireDeveloper(staff);
    const { rows } = await pool.query<{ id: string; name: string; email: string }>(
      `select id, name, email from staff where game_id = $1 and role = 'moderator' order by name`,
      [staff.gameId],
    );
    const rules = await loadRules(pool, rows.map((row) => row.id));
    const body: TeamBody = { moderators: rows.map((row) => ({ ...row, rules: rules.get(row.id) as RuleBody[] })) };
    return { status: 200, body };
  }),

  route('POST', '/api/team/:id/rules', async (ctx) => {
    const { staff } = await staffAccess(ctx, { change: true });
    const moderator = await moderatorOf(staff.gameId, ctx.params.id as string);
    requireDeveloper(staff);
    const input = await ctx.json();
    const fields: Record<string, string> = {};
    if (input.effect !== 'grant' && input.effect !== 'deny') fields.effect = 'Choose grant or deny.';
    if (!ACTIONS.includes(input.action as RuleAction)) fields.action = 'Choose read, reply, close or receipts.';
    if (input.topic !== '*' && !(TOPICS as readonly unknown[]).includes(input.topic)) fields.topic = 'Choose bug, account, purchase, other or all topics.';
    if (Object.keys(fields).length > 0) throw validation(fields);
    const rule = { effect: input.effect as RuleEffect, action: input.action as RuleAction, topic: input.topic as RuleTopic };
    const created = await withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`rules:${moderator.id}`]);
      const existing = await tx.query<RuleBody>(
        'select id, effect, action, topic from rules where moderator_id = $1 and effect = $2 and action = $3 and topic = $4',
        [moderator.id, rule.effect, rule.action, rule.topic],
      );
      if (existing.rows[0]) return { rule: existing.rows[0], isNew: false };
      const id = newId();
      await tx.query('insert into rules (id, moderator_id, effect, action, topic) values ($1, $2, $3, $4, $5)', [id, moderator.id, rule.effect, rule.action, rule.topic]);
      return { rule: { id, ...rule }, isNew: true };
    });
    if (created.isNew) publish({ kind: 'rules', gameId: staff.gameId, moderatorId: moderator.id });
    return { status: created.isNew ? 201 : 200, body: { rule: created.rule } };
  }),

  route('DELETE', '/api/team/:id/rules/:rule', async (ctx) => {
    const { staff } = await staffAccess(ctx, { change: true });
    const moderator = await moderatorOf(staff.gameId, ctx.params.id as string);
    requireDeveloper(staff);
    const removed = await pool.query('delete from rules where id = $1 and moderator_id = $2', [ctx.params.rule, moderator.id]);
    if (removed.rowCount === 0) throw notFound();
    publish({ kind: 'rules', gameId: staff.gameId, moderatorId: moderator.id });
    return { status: 204 };
  }),

  route('GET', '/api/team/:id/effective', async (ctx) => {
    const { staff } = await staffAccess(ctx, { change: false });
    const moderator = await moderatorOf(staff.gameId, ctx.params.id as string);
    requireDeveloper(staff);
    const rules = (await loadRules(pool, [moderator.id])).get(moderator.id) as RuleBody[];
    return { status: 200, body: { effective: effectiveEntries(rules) } };
  }),

  route('PUT', '/api/game/server-secret', async (ctx) => {
    const { staff } = await staffAccess(ctx, { change: true });
    requireDeveloper(staff);
    const input = await ctx.json();
    if (typeof input.secret !== 'string' || !SECRET_FORMAT.test(input.secret)) {
      throw validation({ secret: 'Use 16 to 128 visible characters, with no spaces.' });
    }
    const { rows } = await pool.query<{ previous_valid_until: Date }>(
      `update games set previous_server_secret = server_secret, previous_valid_until = now() + make_interval(secs => $3), server_secret = $2
        where id = $1 returning previous_valid_until`,
      [staff.gameId, input.secret, config.secretOverlapSeconds],
    );
    return { status: 200, body: { previous_valid_until: (rows[0] as { previous_valid_until: Date }).previous_valid_until.toISOString() } };
  }),
];

import { config } from '../config.js';
import { newId, pool, withTransaction } from '../db.js';
import { conflict, notFound, validation } from '../errors.js';
import { jsonObject, requireUser, sendJson, type Router } from '../http.js';
import { queueEmail } from '../outbox.js';
import { findLine, findOrg, findUserById, usersByRole } from '../repo.js';
import { lockRecord, missionInScope, rolesOnly, staffOnly } from './guards.js';

interface FlagRow {
  id: string;
  mission_id: string;
  line_id: string;
  client_org_id: string;
  by_user_id: string;
  comment: string;
  at: Date;
  state: 'Open' | 'Answered';
  reply: string | null;
}

export function registerFlagRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/lines/:lineId/flags',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      const mission = await missionInScope(pool, user, missionId);
      const line = await findLine(pool, ctx.params.lineId!);
      if (!line || line.mission_id !== missionId) throw notFound();
      rolesOnly(user, ['client_reviewer']);
      if (line.status !== 'Delivered') {
        throw conflict('line_not_delivered', `${line.label} is not delivered yet`);
      }
      const raw = jsonObject(ctx).comment;
      const comment = typeof raw === 'string' ? raw.trim() : '';
      if (comment.length < 1 || comment.length > 500) {
        throw validation({ comment: 'Write a comment of 1 to 500 characters' });
      }

      const id = newId('flag');
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO flags (id, mission_id, line_id, client_org_id, by_user_id, comment, at, state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Open')`,
          [id, missionId, line.id, user.client_org_id, user.id, comment, ctx.now.toISOString()],
        );
        const org = await findOrg(client, user.client_org_id ?? '');
        const clientName = org ? org.name : '';
        const body = [
          `${clientName} flagged ${line.label} on ${mission.name}.`,
          comment,
          `${config.publicUrl}/flags`,
        ].join('\r\n');
        for (const surveyor of await usersByRole(client, ['principal_surveyor'])) {
          await queueEmail(client, {
            dedupeKey: `flag:${id}:${surveyor.email}`,
            to: surveyor.email,
            subject: `${clientName} flagged ${line.label} on ${mission.name}`,
            body: `${body}\r\n`,
            purpose: 'flag',
          });
        }
      });

      sendJson(ctx.res, 201, {
        id,
        line_label: line.label,
        comment,
        by: user.name,
        at: ctx.now.toISOString(),
        state: 'Open',
        reply: null,
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/flags',
    body: 'none',
    handler: async (ctx) => {
      staffOnly(requireUser(ctx));
      const onlyOpen = ctx.query.get('state') !== 'all';
      const result = await pool.query<
        FlagRow & { line_label: string; mission_name: string; client_name: string; by_name: string }
      >(
        `SELECT f.*, l.label AS line_label, m.name AS mission_name, o.name AS client_name,
                u.name AS by_name
         FROM flags f
         JOIN lines l ON l.id = f.line_id
         JOIN missions m ON m.id = f.mission_id
         JOIN client_orgs o ON o.id = f.client_org_id
         JOIN users u ON u.id = f.by_user_id
         ${onlyOpen ? `WHERE f.state = 'Open'` : ''}
         ORDER BY f.at DESC, f.id DESC`,
      );
      sendJson(
        ctx.res,
        200,
        result.rows.map((row) => ({
          id: row.id,
          line_id: row.line_id,
          line_label: row.line_label,
          mission_id: row.mission_id,
          mission_name: row.mission_name,
          client_name: row.client_name,
          comment: row.comment,
          by: row.by_name,
          at: row.at.toISOString(),
          state: row.state,
          reply: row.reply,
        })),
      );
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/flags/:flagId/reply',
    body: 'json',
    handler: async (ctx) => {
      const flagId = ctx.params.flagId!;
      const existing = await pool.query<FlagRow>('SELECT * FROM flags WHERE id = $1', [flagId]);
      if (!existing.rows[0]) throw notFound();
      const user = staffOnly(requireUser(ctx));
      const raw = jsonObject(ctx).text;

      const outcome = await withTransaction(async (client) => {
        await lockRecord(client, 'line', flagId);
        const current = await client.query<FlagRow>('SELECT * FROM flags WHERE id = $1', [flagId]);
        const flag = current.rows[0];
        if (!flag) throw notFound();
        if (flag.state === 'Answered') {
          throw conflict('flag_answered', 'That flag already has a reply.');
        }
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (text.length < 1 || text.length > 500) {
          throw validation({ text: 'Write a reply of 1 to 500 characters' });
        }
        await client.query(
          `UPDATE flags SET state = 'Answered', reply = $2, reply_at = $3, reply_by = $4
           WHERE id = $1`,
          [flagId, text, ctx.now.toISOString(), user.name],
        );
        const line = await findLine(client, flag.line_id);
        const mission = await client.query<{ name: string }>(
          'SELECT name FROM missions WHERE id = $1',
          [flag.mission_id],
        );
        const reviewer = await findUserById(client, flag.by_user_id);
        if (reviewer && line) {
          const missionName = mission.rows[0]?.name ?? '';
          await queueEmail(client, {
            dedupeKey: `flagreply:${flagId}:${reviewer.email}`,
            to: reviewer.email,
            subject: `Reply on ${line.label} for ${missionName}`,
            body: [
              `Your flag on ${line.label} for ${missionName} has a reply.`,
              text,
              `${config.publicUrl}/surveys/${flag.mission_id}`,
              '',
            ].join('\r\n'),
            purpose: 'flagreply',
          });
        }
        return { flag, line, text };
      });

      sendJson(ctx.res, 200, {
        id: flagId,
        line_label: outcome.line ? outcome.line.label : '',
        comment: outcome.flag.comment,
        by: (await findUserById(pool, outcome.flag.by_user_id))?.name ?? '',
        at: outcome.flag.at.toISOString(),
        state: 'Answered',
        reply: outcome.text,
      });
    },
  });
}

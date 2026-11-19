import { config } from '../../core/config.js';
import { db, one, transaction } from '../../core/db.js';
import { errors } from '../../core/errors.js';
import { hashPassword, newTotpSecret } from '../../core/crypto.js';
import { hotRankSql } from '../../core/schema.js';
import { renderMarkdown } from '../../domain/markdown.js';
import { ageReport } from '../../domain/reports.js';
import { route, sendJson, type Ctx, type Route } from '../http.js';

export function gradingEnabled(ctx: Ctx): boolean {
  const key = config.gradingKey;
  if (key === null) return false;
  const header = ctx.req.headers['x-grading-key'];
  return (Array.isArray(header) ? header[0] : header) === key;
}

function guard(ctx: Ctx): void {
  if (!gradingEnabled(ctx)) throw errors.notFound('Not found');
}

async function memberIdByUsername(username: string): Promise<string> {
  const row = await one<{ id: string }>(db, 'select id from members where username_ci = $1', [
    String(username).toLowerCase(),
  ]);
  if (!row) throw errors.notFound(`Unknown member ${username}`);
  return String(row.id);
}

export const gradingRoutes: Route[] = [
  route('POST', '/api/grading/users', async (ctx) => {
    guard(ctx);
    const username = String(ctx.body.username ?? '');
    const email = String(ctx.body.email ?? '');
    const password = String(ctx.body.password ?? '');
    const verified = ctx.body.verified === true;
    const accountAgeDays = Number(ctx.body.accountAgeDays ?? 0);
    const role = ctx.body.role === 'admin' ? 'admin' : 'user';
    const totp = ctx.body.totp === true;
    const secret = totp ? newTotpSecret() : null;

    const row = await one<{ id: string; username: string }>(
      db,
      `insert into members (username, username_ci, email, email_ci, password_hash, email_verified, role,
         totp_secret, totp_enabled, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - make_interval(days => $10::integer))
       returning id, username`,
      [
        username,
        username.toLowerCase(),
        email,
        email.toLowerCase(),
        await hashPassword(password),
        verified,
        role,
        secret,
        totp,
        accountAgeDays,
      ],
    );
    sendJson(ctx, 201, { id: String(row?.id), username: row?.username, totpSecret: secret });
  }),

  route('POST', '/api/grading/communities', async (ctx) => {
    guard(ctx);
    const name = String(ctx.body.name ?? '');
    const title = String(ctx.body.title ?? name);
    const type = ctx.body.type === 'restricted' ? 'restricted' : 'public';
    const ownerId = await memberIdByUsername(String(ctx.body.owner ?? ''));
    const moderators = Array.isArray(ctx.body.moderators) ? ctx.body.moderators.map(String) : [];
    const members = Array.isArray(ctx.body.members) ? ctx.body.members.map(String) : [];
    const rules = Array.isArray(ctx.body.rules) ? (ctx.body.rules as Record<string, unknown>[]) : [];

    const memberIds = new Set<string>([ownerId]);
    for (const username of [...moderators, ...members]) memberIds.add(await memberIdByUsername(username));
    const moderatorIds = new Set<string>([ownerId]);
    for (const username of moderators) moderatorIds.add(await memberIdByUsername(username));

    const requestedCount = Number(ctx.body.memberCount ?? memberIds.size);
    const memberCount = Math.max(requestedCount, memberIds.size);

    const result = await transaction(async (tx) => {
      const community = await one<{ id: string; name: string }>(
        tx,
        `insert into communities (name, name_ci, title, description, type, owner_id, member_count)
         values ($1, $2, $3, '', $4, $5, $6) returning id, name`,
        [name, name.toLowerCase(), title, type, ownerId, memberCount],
      );
      const communityId = String(community?.id);
      for (const memberId of memberIds) {
        await tx.query('insert into memberships (community_id, member_id) values ($1, $2) on conflict do nothing', [
          communityId,
          memberId,
        ]);
      }
      for (const moderatorId of moderatorIds) {
        await tx.query(
          'insert into moderators (community_id, member_id, is_owner) values ($1, $2, $3) on conflict do nothing',
          [communityId, moderatorId, moderatorId === ownerId],
        );
      }
      const ruleIds: string[] = [];
      for (const [index, rule] of rules.entries()) {
        const inserted = await one<{ id: string }>(
          tx,
          'insert into community_rules (community_id, position, title, description) values ($1, $2, $3, $4) returning id',
          [communityId, index, String(rule.title ?? ''), String(rule.description ?? '')],
        );
        ruleIds.push(String(inserted?.id));
      }
      return { id: communityId, name: community?.name, ruleIds };
    });
    sendJson(ctx, 201, result);
  }),

  route('POST', '/api/grading/posts', async (ctx) => {
    guard(ctx);
    const community = await one<{ id: string; name: string }>(db, 'select id, name from communities where name_ci = $1', [
      String(ctx.body.community ?? '').toLowerCase(),
    ]);
    if (!community) throw errors.notFound('Unknown community');
    const authorId = await memberIdByUsername(String(ctx.body.author ?? ''));
    const title = String(ctx.body.title ?? '');
    const bodyMd = String(ctx.body.bodyMd ?? '');
    const score = Number(ctx.body.score ?? 0);
    const createdAt = typeof ctx.body.createdAt === 'string' ? ctx.body.createdAt : null;
    const spoiler = ctx.body.spoiler === true;

    const row = await one<{ id: string; hot_rank: number }>(
      db,
      `insert into posts (community_id, author_id, title, body_md, body_html, spoiler, score, created_at, hot_rank)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), 0)
       returning id, hot_rank`,
      [community.id, authorId, title, bodyMd, renderMarkdown(bodyMd), spoiler, score, createdAt],
    );
    const updated = await one<{ hot_rank: number }>(
      db,
      `update posts set hot_rank = ${hotRankSql('score')} where id = $1 returning hot_rank`,
      [row?.id],
    );
    sendJson(ctx, 201, {
      id: String(row?.id),
      url: `/c/${community.name}/post/${row?.id}`,
      hotRank: Number(updated?.hot_rank ?? 0),
    });
  }),

  route('POST', '/api/grading/comment-trees', async (ctx) => {
    guard(ctx);
    const postId = String(ctx.body.postId ?? '');
    const authorId = await memberIdByUsername(String(ctx.body.author ?? ''));
    const depth = Math.max(1, Number(ctx.body.depth ?? 1));
    const siblings = Math.max(1, Number(ctx.body.siblings ?? 1));

    const levels = await transaction(async (tx) => {
      const built: string[][] = [];
      let parent: { id: string; path: string[] } | null = null;
      for (let level = 1; level <= depth; level += 1) {
        const ids: string[] = [];
        const path: string[] = parent ? [...parent.path, parent.id] : [];
        for (let index = 0; index < siblings; index += 1) {
          const inserted: { id: string } | null = await one<{ id: string }>(
            tx,
            `insert into comments (post_id, parent_id, author_id, body_md, body_html, depth, path, state)
             values ($1, $2, $3, $4, $5, $6, $7::bigint[], 'published') returning id`,
            [
              postId,
              parent ? parent.id : null,
              authorId,
              `Seeded reply at level ${level}, number ${index + 1}`,
              `<p>Seeded reply at level ${level}, number ${index + 1}</p>`,
              level,
              path,
            ],
          );
          ids.push(String(inserted?.id));
        }
        if (path.length > 0) {
          await tx.query('update comments set descendant_count = descendant_count + $2 where id = any($1::bigint[])', [
            path,
            siblings,
          ]);
        }
        built.push(ids);
        parent = { id: ids[0], path };
      }
      await tx.query('update posts set comment_count = comment_count + $2 where id = $1', [
        postId,
        depth * siblings,
      ]);
      return built;
    });
    sendJson(ctx, 201, { levels });
  }),

  route('POST', '/api/grading/reports/:reference/age', async (ctx) => {
    guard(ctx);
    sendJson(ctx, 200, await ageReport(ctx.params.reference, Number(ctx.body.seconds ?? 0)));
  }),
];

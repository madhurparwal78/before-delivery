/* Grading routes: they exist only when GRADING_KEY is set, are authorised by
   the X-Grading-Key header, and skip Origin checks, rate limits and mail. */
import argon2 from 'argon2';
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { hotRank, renderMarkdownSafe } from '../grading-lib.js';
import { iso } from '../util.js';

export function registerGradingRoutes(services: Services, add: (r: Route) => void): void {
  if (services.cfg.gradingKey === null) return;
  add(route('POST', '/api/grading/users', createUser(services)));
  add(route('POST', '/api/grading/communities', createCommunity(services)));
  add(route('POST', '/api/grading/posts', createPost(services)));
  add(route('POST', '/api/grading/comment-trees', createCommentTree(services)));
  add(route('POST', '/api/grading/reports/:reference/age', ageReport(services)));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function int(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) ? v : fallback;
}

function createUser(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const username = str(b.username);
    const email = str(b.email);
    const password = str(b.password);
    const verified = b.verified === true;
    const accountAgeDays = int(b.accountAgeDays, 0);
    const role = str(b.role) === 'admin' ? 'admin' : 'user';
    const totp = b.totp === true;
    const fields: Record<string, string> = {};
    if (username === '' || email === '' || password === '') fields.username = 'Missing fields';
    if (Object.keys(fields).length > 0) throw validation(fields);
    const secret = totp ? 'JBSWY3DPEHPK3PXP' : null;
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const inserted = await services.db.query(
      `INSERT INTO accounts (username, username_lc, email, email_lc, password_hash, email_verified, totp_secret, totp_enabled, role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10))
       ON CONFLICT (username_lc) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
         email_verified = EXCLUDED.email_verified, totp_secret = EXCLUDED.totp_secret, totp_enabled = EXCLUDED.totp_enabled,
         role = EXCLUDED.role, created_at = EXCLUDED.created_at
       RETURNING id, username_lc`,
      [username, username.toLowerCase(), email, email.toLowerCase(), hash, verified, secret, totp, role, accountAgeDays]
    );
    const row = inserted.rows[0] as { id: string; username_lc: string };
    void row.username_lc;
    return { status: 201, body: { id: Number(row.id), username, totpSecret: secret } };
  };
}

function createCommunity(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const name = str(b.name);
    const title = str(b.title);
    const type = str(b.type) === 'restricted' ? 'restricted' : 'public';
    const owner = str(b.owner);
    const moderators = Array.isArray(b.moderators) ? (b.moderators as unknown[]).map(String) : [];
    const members = Array.isArray(b.members) ? (b.members as unknown[]).map(String) : [];
    const memberCount = int(b.memberCount, members.length);
    const rules = Array.isArray(b.rules) ? (b.rules as Record<string, unknown>[]) : [];
    const accountAge = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [owner.toLowerCase()]);
    if (accountAge.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown owner');
    const ownerId = Number((accountAge.rows[0] as { id: string }).id);
    const existing = await services.db.query(`SELECT id FROM communities WHERE name_lc = $1`, [name.toLowerCase()]);
    let communityId: number;
    if (existing.rows.length > 0) {
      communityId = Number((existing.rows[0] as { id: string }).id);
    } else {
      const inserted = await services.db.query(
        `INSERT INTO communities (name, name_lc, title, type, member_count) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, name.toLowerCase(), title, type, memberCount]
      );
      communityId = Number((inserted.rows[0] as { id: string }).id);
    }
    await services.db.query(`UPDATE communities SET member_count = $2 WHERE id = $1`, [communityId, Math.max(memberCount, members.length)]);
    await services.db.query(`DELETE FROM moderators WHERE community_id = $1`, [communityId]);
    await services.db.query(`DELETE FROM memberships WHERE community_id = $1`, [communityId]);
    await services.db.query(`DELETE FROM rules WHERE community_id = $1`, [communityId]);
    const ownerAndMods = [...new Set([owner, ...moderators])];
    for (const username of ownerAndMods) {
      const rows = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
      if (rows.rows.length === 0) continue;
      const id = Number((rows.rows[0] as { id: string }).id);
      await services.db.query(`INSERT INTO moderators (community_id, account_id, is_owner) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [communityId, id, username === owner]);
    }
    for (const username of [...new Set([...ownerAndMods, ...members])]) {
      const rows = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
      if (rows.rows.length === 0) continue;
      const id = Number((rows.rows[0] as { id: string }).id);
      await services.db.query(`INSERT INTO memberships (community_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [communityId, id]);
    }
    const ruleIds: number[] = [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i] as { title?: unknown; description?: unknown };
      const inserted = await services.db.query(
        `INSERT INTO rules (community_id, position, title, description) VALUES ($1,$2,$3,$4) RETURNING id`,
        [communityId, i, str(r.title), str(r.description)]
      );
      ruleIds.push(Number((inserted.rows[0] as { id: string }).id));
    }
    return { status: 201, body: { id: communityId, name, ruleIds } };
  };
}

function createPost(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const communityName = str(b.community);
    const author = str(b.author);
    const title = str(b.title);
    const bodyMd = str(b.bodyMd);
    const score = int(b.score, 0);
    const createdAt = str(b.createdAt);
    const spoiler = b.spoiler === true;
    const communityRows = await services.db.query(`SELECT id FROM communities WHERE name_lc = $1`, [communityName.toLowerCase()]);
    if (communityRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown community');
    const communityId = Number((communityRows.rows[0] as { id: string }).id);
    const authorRows = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [author.toLowerCase()]);
    if (authorRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown author');
    const authorId = Number((authorRows.rows[0] as { id: string }).id);
    // `createdAt` is stored as the server-stamped creation time.
    const created = new Date();
    const rank = hotRank(score, created);
    const inserted = await services.db.query(
      `INSERT INTO posts (community_id, author_id, title, body_md, body_html, spoiler, score, hot_rank, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [communityId, authorId, title, bodyMd === '' ? null : bodyMd, bodyMd === '' ? null : renderMarkdownSafe(bodyMd), spoiler, score, rank, created]
    );
    const id = Number((inserted.rows[0] as { id: string }).id);
    void createdAt;
    return { status: 201, body: { id, url: `/c/${communityName}/post/${id}`, hotRank: rank, createdAt: iso(created) } };
  };
}

function createCommentTree(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const postId = int(b.postId, 0);
    const author = str(b.author);
    const depth = int(b.depth, 1);
    const siblings = int(b.siblings, 1);
    const authorRows = await services.db.query(`SELECT id FROM accounts WHERE username_lc = $1`, [author.toLowerCase()]);
    if (authorRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown author');
    const authorId = Number((authorRows.rows[0] as { id: string }).id);
    const postRows = await services.db.query(`SELECT id, community_id FROM posts WHERE id = $1`, [postId]);
    if (postRows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Unknown post');
    const levels: number[][] = [];
    const pathOfParent = new Map<number, string>();
    let totalComments = 0;
    await services.db.query(`BEGIN`);
    try {
      for (let level = 1; level <= depth; level++) {
        // Level 1 has `siblings` comments; every level below has one comment
        // hanging off the first comment of the level above.
        const count = level === 1 ? siblings : 1;
        const ids: number[] = [];
        for (let i = 0; i < count; i++) {
          const parentId = level === 1 ? null : (levels[level - 2] as number[])[0];
          const parentPath = level === 1 ? '' : pathOfParent.get(parentId as number) ?? '';
          const inserted = await services.db.query(
            `INSERT INTO comments (post_id, parent_id, author_id, path, depth, body_md, body_html) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [postId, parentId, authorId, parentPath, level, `Comment ${level}-${i + 1}`, renderMarkdownSafe(`Comment ${level}-${i + 1}`)]
          );
          const id = Number((inserted.rows[0] as { id: string }).id);
          pathOfParent.set(id, parentPath === '' ? String(id) : `${parentPath}.${id}`);
          ids.push(id);
          totalComments++;
        }
        levels.push(ids);
      }
      await services.db.query(`UPDATE posts SET comment_count = comment_count + $2 WHERE id = $1`, [postId, totalComments]);
      await updateDescendants(services, postId);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    return { status: 201, body: { levels } };
  };
}

async function updateDescendants(services: Services, postId: number): Promise<void> {
  await services.db.query(
    `UPDATE comments c SET descendant_count = (
       SELECT count(*) FROM comments d
       WHERE d.post_id = $1 AND d.state = 'published'
         AND ('.' || d.path || '.') LIKE ('%.' || c.id || '.%')
         AND d.id <> c.id
     ) WHERE c.post_id = $1`,
    [postId]
  );
}

function ageReport(services: Services): RouteHandler {
  return async (ctx) => {
    const reference = ctx.params.reference as string;
    const seconds = int(body(ctx).seconds, 0);
    const rows = await services.db.query(`SELECT created_at, deadline_at FROM reports WHERE reference = $1`, [reference]);
    if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    await services.db.query(
      `UPDATE reports SET created_at = created_at - make_interval(secs => $2), deadline_at = deadline_at - make_interval(secs => $2) WHERE reference = $1`,
      [reference, seconds]
    );
    const fresh = await services.db.query(`SELECT created_at, deadline_at FROM reports WHERE reference = $1`, [reference]);
    const row = fresh.rows[0] as { created_at: Date; deadline_at: Date };
    return { status: 200, body: { reference, createdAt: iso(new Date(row.created_at)), deadlineAt: iso(new Date(row.deadline_at)) } };
  };
}

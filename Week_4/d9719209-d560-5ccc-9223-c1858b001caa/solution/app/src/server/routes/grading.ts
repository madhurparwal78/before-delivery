import { pool, one, tx } from '../db.js';
import { config } from '../config.js';
import { secondsAgo, now } from '../clock.js';
import { notFound } from '../errors.js';
import { created, ok, route, type Ctx, type Reply } from '../http.js';
import { hashPassword, insertUser } from '../accounts.js';
import { insertComment, insertCommunity, insertPost } from '../writes.js';
import { newSecret } from '../totp.js';
import { asRecord, asString } from '../validate.js';

/** The grading routes exist only while GRADING_KEY is set and the caller presents it. */
function authorise(ctx: Ctx): Record<string, unknown> {
  if (!config.gradingKey || ctx.headers['x-grading-key'] !== config.gradingKey) throw notFound('No such endpoint');
  return asRecord(ctx.body);
}

async function userId(db: typeof pool, username: string): Promise<string> {
  const row = await one<{ id: string }>(db, 'SELECT id FROM users WHERE username_key = lower($1)', [username]);
  if (!row) throw notFound(`No such member ${username}`);
  return row.id;
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

async function makeUser(ctx: Ctx): Promise<Reply> {
  const input = authorise(ctx);
  const secret = input.totp === true ? newSecret() : null;
  const days = typeof input.accountAgeDays === 'number' ? input.accountAgeDays : 0;
  const username = asString(input.username) as string;
  const id = await insertUser(pool, {
    username, email: asString(input.email) as string, passwordHash: await hashPassword(asString(input.password) as string),
    emailVerified: input.verified === true, role: input.role === 'admin' ? 'admin' : 'user', totpSecret: secret,
    createdAt: secondsAgo(days * 86_400),
  });
  return created({ id, username, totpSecret: secret });
}

async function makeCommunity(ctx: Ctx): Promise<Reply> {
  const input = authorise(ctx);
  const owner = await userId(pool, asString(input.owner) as string);
  const moderators = await Promise.all([...new Set([asString(input.owner) as string, ...names(input.moderators)])].map((n) => userId(pool, n)));
  const members = await Promise.all(names(input.members).map((n) => userId(pool, n)));
  const rules = (Array.isArray(input.rules) ? input.rules : []).map((r) => ({
    title: asString(asRecord(r).title) ?? '', description: asString(asRecord(r).description) ?? '',
  }));
  const name = asString(input.name) as string;
  const made = await tx((client) => insertCommunity(client, {
    name, title: asString(input.title) ?? name, description: '', type: input.type === 'restricted' ? 'restricted' : 'public',
    ownerId: owner, rules, moderatorIds: moderators, memberIds: [...new Set([owner, ...moderators, ...members])],
    memberCount: typeof input.memberCount === 'number' ? input.memberCount : members.length,
  }));
  return created({ id: made.id, name, ruleIds: made.ruleIds });
}

async function makePost(ctx: Ctx): Promise<Reply> {
  const input = authorise(ctx);
  const community = await one<{ id: string; name: string }>(pool, 'SELECT id, name FROM communities WHERE name_key = lower($1)', [asString(input.community) ?? '']);
  if (!community) throw notFound('No such community');
  const id = await tx(async (client) => insertPost(client, {
    communityId: community.id, authorId: await userId(pool, asString(input.author) as string), title: asString(input.title) as string,
    bodyMd: asString(input.bodyMd) ?? '', spoiler: input.spoiler === true, score: typeof input.score === 'number' ? input.score : 0,
    createdAt: new Date(asString(input.createdAt) ?? now().toISOString()), images: [],
  }));
  const stored = await one<{ hot_rank: number }>(pool, 'SELECT hot_rank FROM posts WHERE id = $1', [id]);
  return created({ id, url: `/c/${community.name}/post/${id}`, hotRank: stored?.hot_rank });
}

async function makeCommentTree(ctx: Ctx): Promise<Reply> {
  const input = authorise(ctx);
  const postId = String(input.postId);
  const author = await userId(pool, asString(input.author) as string);
  const depth = Number(input.depth);
  const siblings = Number(input.siblings);
  const levels = await tx(async (client) => {
    const made: string[][] = [];
    for (let level = 1; level <= depth; level += 1) {
      const parents = level === 1 ? [null] : [(made[level - 2] as string[])[0] as string];
      const row: string[] = [];
      for (const parentId of parents) {
        for (let n = 0; n < siblings; n += 1) {
          row.push(await insertComment(client, { postId, parentId, authorId: author, bodyMd: `Level ${level}, comment ${n + 1}.`, createdAt: now() }));
        }
      }
      made.push(row);
    }
    return made;
  });
  return created({ levels });
}

async function ageReport(ctx: Ctx): Promise<Reply> {
  const input = authorise(ctx);
  const moved = await one<{ reference: string; created_at: Date }>(pool,
    `UPDATE reports SET created_at = created_at - make_interval(secs => $2) WHERE reference = $1 RETURNING reference, created_at`,
    [ctx.params.reference as string, Number(input.seconds)]);
  if (!moved) throw notFound('No such report');
  const deadline = new Date(moved.created_at.getTime() + config.limits.reportDeadlineSeconds * 1000);
  return ok({ reference: moved.reference, createdAt: moved.created_at.toISOString(), deadlineAt: deadline.toISOString() });
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/users', makeUser, { checkOrigin: false });
  route('POST', '/api/grading/communities', makeCommunity, { checkOrigin: false });
  route('POST', '/api/grading/posts', makePost, { checkOrigin: false });
  route('POST', '/api/grading/comment-trees', makeCommentTree, { checkOrigin: false });
  route('POST', '/api/grading/reports/:reference/age', ageReport, { checkOrigin: false });
}


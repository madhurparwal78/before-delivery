import { randomUUID } from 'node:crypto';
import { AUTH_COPY } from '../../shared/copy';
import type { GroupMode, Layout, LinkAccess, Privacy, Role, SortMode } from '../../shared/types';
import { boardDto, newLinkToken, type BoardRow } from '../boards';
import { inTransaction, pool } from '../db';
import { env } from '../env';
import { invalid, notFound } from '../errors';
import type { Ctx, Router } from '../http';
import { hashPassword, makeSessionValue } from '../session';
import { normaliseEmail } from '../../shared/validate';

interface FixtureUser {
  key: string;
  display_name: string;
  email: string;
  password: string;
  verified?: boolean;
}

interface FixturePost {
  key?: string;
  section: string;
  author: string;
  title: string;
  body?: string;
  state?: string;
  likes?: string[];
  votes?: Record<string, number>;
  comments?: Array<{ author: string; text: string }>;
}

interface FixtureBoard {
  key: string;
  owner: string;
  title: string;
  layout?: string;
  sections?: string[];
  sort?: string;
  group?: string;
  privacy?: string;
  password?: string | null;
  approval?: boolean;
  link_access?: string;
  members?: Record<string, string>;
  posts?: FixturePost[];
}

interface FixtureRequest {
  users?: FixtureUser[];
  boards?: FixtureBoard[];
}

const oneOf = <T extends string>(path: string, value: string | undefined, allowed: T[], fallback: T): T => {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) throw invalid({ [path]: 'Not a known value.' });
  return value as T;
};

const fixture = async (ctx: Ctx): Promise<void> => {
  const provided = ctx.req.headers['x-grading-key'];
  if (env.gradingKey === null || provided !== env.gradingKey) throw notFound();
  const body = await ctx.json<FixtureRequest>();
  const users = body.users ?? [];
  if (users.length === 0) throw invalid({ users: 'Not a known value.' });

  const userIds = new Map<string, string>();
  const seenEmails = new Set<string>();
  for (const [index, user] of users.entries()) {
    const email = normaliseEmail(user.email);
    const existing = await pool.query('select 1 from users where email = $1', [email]);
    if (seenEmails.has(email) || (existing.rowCount ?? 0) > 0) {
      throw invalid({ [`users.${index}.email`]: AUTH_COPY.emailTaken });
    }
    seenEmails.add(email);
    userIds.set(user.key, randomUUID());
  }

  const userId = (path: string, key: string): string => {
    const id = userIds.get(key);
    if (id === undefined) throw invalid({ [path]: 'Not a known value.' });
    return id;
  };

  const response = await inTransaction(async (client) => {
    for (const user of users) {
      await client.query(
        `insert into users (id, display_name, email, password_hash, verified)
         values ($1, $2, $3, $4, $5)`,
        [
          userId(`users.${user.key}`, user.key),
          user.display_name,
          normaliseEmail(user.email),
          hashPassword(user.password),
          user.verified !== false,
        ],
      );
    }

    const boards: Record<string, unknown> = {};
    for (const [boardIndex, board] of (body.boards ?? []).entries()) {
      const path = `boards.${boardIndex}`;
      const layout = oneOf<Layout>(`${path}.layout`, board.layout, ['columns', 'rows'], 'columns');
      const sort = oneOf<SortMode>(`${path}.sort`, board.sort, ['by_hand', 'newest', 'oldest', 'most_liked'], 'by_hand');
      const group = oneOf<GroupMode>(`${path}.group`, board.group, ['section', 'author'], 'section');
      const privacy = oneOf<Privacy>(`${path}.privacy`, board.privacy, ['private', 'password', 'public'], 'private');
      const linkAccessValue = oneOf<LinkAccess>(`${path}.link_access`, board.link_access, ['off', 'view', 'contribute'], 'off');
      const boardId = randomUUID();
      const inserted = await client.query<BoardRow>(
        `insert into boards (id, owner_id, title, layout, sort, grouping, privacy, password_hash, approval, link_access, link_token)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, owner_id, title, layout, sort, grouping, privacy, password_hash, approval,
           link_access, link_token, unlock_generation`,
        [
          boardId,
          userId(`${path}.owner`, board.owner),
          board.title,
          layout,
          sort,
          group,
          privacy,
          board.password === null || board.password === undefined ? null : hashPassword(board.password),
          board.approval === true,
          linkAccessValue,
          linkAccessValue === 'off' ? null : newLinkToken(),
        ],
      );

      const sectionIds: Record<string, string> = {};
      for (const [index, title] of (board.sections ?? []).entries()) {
        const sectionId = randomUUID();
        sectionIds[title] = sectionId;
        await client.query('insert into sections (id, board_id, title, ord) values ($1, $2, $3, $4)', [
          sectionId,
          boardId,
          title,
          index,
        ]);
      }

      for (const [memberKey, role] of Object.entries(board.members ?? {})) {
        const memberRole = oneOf<Exclude<Role, 'owner'>>(
          `${path}.members.${memberKey}`,
          role,
          ['viewer', 'contributor', 'moderator'],
          'viewer',
        );
        await client.query('insert into memberships (board_id, user_id, role) values ($1, $2, $3)', [
          boardId,
          userId(`${path}.members.${memberKey}`, memberKey),
          memberRole,
        ]);
      }

      const postIds: Record<string, string> = {};
      const nextPosition: Record<string, number> = {};
      for (const [postIndex, post] of (board.posts ?? []).entries()) {
        const postPath = `${path}.posts.${postIndex}`;
        const sectionId = sectionIds[post.section];
        if (sectionId === undefined) throw invalid({ [`${postPath}.section`]: 'Not a known value.' });
        const state = oneOf(`${postPath}.state`, post.state, ['published', 'awaiting_approval'], 'published');
        const postId = randomUUID();
        if (post.key !== undefined) postIds[post.key] = postId;
        let position: number | null = null;
        if (state === 'published') {
          nextPosition[sectionId] = (nextPosition[sectionId] ?? 0) + 1;
          position = nextPosition[sectionId];
        }
        const authorId = userId(`${postPath}.author`, post.author);
        await client.query(
          `insert into posts (id, board_id, section_id, author_id, title, body, state, position, push_state, last_actor_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4)`,
          [
            postId,
            boardId,
            sectionId,
            authorId,
            post.title,
            post.body ?? '',
            state,
            position,
            state === 'awaiting_approval' ? 'sent' : null,
          ],
        );
        for (const likeKey of post.likes ?? []) {
          await client.query('insert into likes (post_id, user_id) values ($1, $2) on conflict do nothing', [
            postId,
            userId(`${postPath}.likes`, likeKey),
          ]);
        }
        for (const [voteKey, value] of Object.entries(post.votes ?? {})) {
          if (value !== 1 && value !== -1) throw invalid({ [`${postPath}.votes.${voteKey}`]: 'Not a known value.' });
          await client.query('insert into votes (post_id, user_id, value) values ($1, $2, $3)', [
            postId,
            userId(`${postPath}.votes.${voteKey}`, voteKey),
            value,
          ]);
        }
        for (const comment of post.comments ?? []) {
          await client.query('insert into comments (id, post_id, author_id, text) values ($1, $2, $3, $4)', [
            randomUUID(),
            postId,
            userId(`${postPath}.comments`, comment.author),
            comment.text,
          ]);
        }
      }

      const dto = await boardDto(client, inserted.rows[0], 'owner');
      boards[board.key] = {
        id: boardId,
        path: `/b/${boardId}`,
        share_path: dto.share_path,
        embed_path: dto.embed_path,
        sections: sectionIds,
        posts: postIds,
      };
    }

    const userResponse: Record<string, { id: string; session: string }> = {};
    for (const user of users) {
      const id = userId(`users.${user.key}`, user.key);
      userResponse[user.key] = { id, session: makeSessionValue(id) };
    }
    return { users: userResponse, boards };
  });

  ctx.sendJson(201, response);
};

export const registerGradingRoutes = (router: Router): void => {
  router.add('POST', '/api/grading/fixture', fixture);
};

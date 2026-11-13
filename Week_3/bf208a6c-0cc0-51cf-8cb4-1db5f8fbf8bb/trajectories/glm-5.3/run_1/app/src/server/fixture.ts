import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import { notFound, validation } from './errors.js';
import { randomId, randomToken } from './util.js';
import bcrypt from 'bcryptjs';
import type { Role, Layout, Sort, Group, Privacy, LinkAccess } from '../shared/types.js';
import { createSession } from './sessions.js';

interface FixtureUser {
  key: string;
  display_name: string;
  email: string;
  password: string;
  verified: boolean;
}

interface FixtureComment {
  author: string;
  text: string;
}

interface FixturePost {
  key: string;
  section: string;
  author: string;
  title: string;
  body: string;
  state: 'published' | 'awaiting_approval';
  likes: string[];
  votes: Record<string, number>;
  comments: FixtureComment[];
}

interface FixtureBoard {
  key: string;
  owner: string;
  title: string;
  layout: Layout;
  sections: string[];
  sort: Sort;
  group: Group;
  privacy: Privacy;
  password: string | null;
  approval: boolean;
  link_access: LinkAccess;
  members: Record<string, Role>;
  posts: FixturePost[];
}

export async function handleGradingFixture(app: App, ctx: RequestContext): Promise<void> {
  if (!app.config.gradingKey) throw notFound();
  if (ctx.req.headers['x-grading-key'] !== app.config.gradingKey) throw notFound();
  const body = (ctx.jsonBody ?? {}) as {
    users?: Partial<FixtureUser>[];
    boards?: Partial<FixtureBoard>[];
  };

  const errors: Record<string, string> = {};
  const users: FixtureUser[] = [];
  const userIndex = new Map<string, FixtureUser>();
  for (const [i, raw] of (body.users ?? []).entries()) {
    if (!raw.key || !raw.email || !raw.password || !raw.display_name) {
      errors[`users.${i}`] = 'key, display_name, email and password are required.';
      continue;
    }
    const user: FixtureUser = {
      key: raw.key,
      display_name: raw.display_name,
      email: raw.email,
      password: raw.password,
      verified: raw.verified ?? true,
    };
    users.push(user);
    userIndex.set(user.key, user);
  }

  const boards: FixtureBoard[] = [];
  for (const [i, raw] of (body.boards ?? []).entries()) {
    if (!raw.key || !raw.owner || !raw.title || !raw.sections) {
      errors[`boards.${i}`] = 'key, owner, title and sections are required.';
      continue;
    }
    if (!userIndex.has(raw.owner)) {
      errors[`boards.${i}.owner`] = 'Unknown user key.';
      continue;
    }
    const board: FixtureBoard = {
      key: raw.key,
      owner: raw.owner,
      title: raw.title,
      layout: raw.layout ?? 'columns',
      sections: raw.sections,
      sort: raw.sort ?? 'by_hand',
      group: raw.group ?? 'section',
      privacy: raw.privacy ?? 'private',
      password: raw.password ?? null,
      approval: raw.approval ?? false,
      link_access: raw.link_access ?? 'off',
      members: raw.members ?? {},
      posts: (raw.posts ?? []).map((p) => ({
        key: p.key ?? randomId('p'),
        section: p.section ?? '',
        author: p.author ?? raw.owner!,
        title: p.title ?? '',
        body: p.body ?? '',
        state: p.state ?? 'published',
        likes: p.likes ?? [],
        votes: p.votes ?? {},
        comments: p.comments ?? [],
      })),
    };
    for (const [memberKey] of Object.entries(board.members)) {
      if (!userIndex.has(memberKey)) errors[`boards.${i}.members.${memberKey}`] = 'Unknown user key.';
    }
    for (const [p, post] of board.posts.entries()) {
      if (!userIndex.has(post.author)) errors[`boards.${i}.posts.${p}.author`] = 'Unknown user key.';
      if (!board.sections.includes(post.section)) errors[`boards.${i}.posts.${p}.section`] = 'Unknown section.';
      for (const likeKey of post.likes) {
        if (!userIndex.has(likeKey)) errors[`boards.${i}.posts.${p}.likes`] = 'Unknown user key.';
      }
      for (const [voteKey, value] of Object.entries(post.votes)) {
        if (!userIndex.has(voteKey)) errors[`boards.${i}.posts.${p}.votes`] = 'Unknown user key.';
        if (value !== 1 && value !== -1) errors[`boards.${i}.posts.${p}.votes.${voteKey}`] = 'Vote must be 1 or -1.';
      }
      for (const [c, comment] of post.comments.entries()) {
        if (!userIndex.has(comment.author)) errors[`boards.${i}.posts.${p}.comments.${c}.author`] = 'Unknown user key.';
      }
    }
    boards.push(board);
  }

  if (Object.keys(errors).length > 0) throw validation(errors);

  const userResults: Record<string, { id: string; session: string }> = {};
  const boardResults: Record<
    string,
    { id: string; path: string; share_path: string | null; embed_path: string | null; sections: Record<string, string>; posts: Record<string, string> }
  > = {};

  for (const user of users) {
    const userId = randomId('usr');
    const hash = await bcrypt.hash(user.password, 10);
    await app.db.query('INSERT INTO users (id, display_name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      user.display_name,
      user.email,
      hash,
      user.verified,
    ]);
    const session = await createSession(app.db, userId);
    userResults[user.key] = { id: userId, session };
  }

  for (const board of boards) {
    const boardId = randomId('brd');
    const ownerId = userResults[board.owner]!.id;
    const passHash = board.password ? await bcrypt.hash(board.password, 10) : null;
    const linkToken = board.link_access !== 'off' && board.privacy !== 'private' ? randomToken(24) : null;
    await app.db.query(
      `INSERT INTO boards (id, title, layout, sort, "group", privacy, approval, link_access, link_token, pass_hash, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        boardId,
        board.title,
        board.layout,
        board.sort,
        board.group,
        board.privacy,
        board.approval,
        board.link_access,
        linkToken,
        passHash,
        ownerId,
      ],
    );
    await app.db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [boardId, ownerId, 'owner']);
    const sectionIds: Record<string, string> = {};
    for (const [index, sectionTitle] of board.sections.entries()) {
      const sectionId = randomId('sec');
      sectionIds[sectionTitle] = sectionId;
      await app.db.query('INSERT INTO sections (id, board_id, title, position) VALUES ($1, $2, $3, $4)', [
        sectionId,
        boardId,
        sectionTitle,
        index + 1,
      ]);
    }
    for (const [memberKey, role] of Object.entries(board.members)) {
      const memberId = userResults[memberKey]?.id;
      if (!memberId) continue;
      await app.db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [
        boardId,
        memberId,
        role === 'owner' ? 'moderator' : role,
      ]);
    }
    const postIds: Record<string, string> = {};
    const sectionCounters = new Map<string, number>();
    for (const post of board.posts) {
      const postId = randomId('pst');
      postIds[post.key] = postId;
      const sectionId = sectionIds[post.section] ?? '';
      const held = post.state === 'awaiting_approval';
      let position: number | null = null;
      if (!held) {
        const next = (sectionCounters.get(post.section) ?? 0) + 1;
        sectionCounters.set(post.section, next);
        position = next;
      }
      await app.db.query(
        `INSERT INTO posts (id, board_id, section_id, author_id, position, title, body, state, push_state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - ($10 || ' seconds')::interval)`,
        [
          postId,
          boardId,
          sectionId,
          userResults[post.author]!.id,
          position,
          post.title,
          post.body,
          post.state,
          held ? 'sent' : null,
          String(board.posts.indexOf(post) * 10),
        ],
      );
      for (const likeKey of post.likes) {
        await app.db.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [postId, userResults[likeKey]!.id]);
      }
      for (const [voteKey, value] of Object.entries(post.votes)) {
        await app.db.query('INSERT INTO votes (post_id, user_id, value) VALUES ($1, $2, $3)', [
          postId,
          userResults[voteKey]!.id,
          value,
        ]);
      }
      for (const comment of post.comments) {
        await app.db.query('INSERT INTO comments (id, post_id, author_id, text) VALUES ($1, $2, $3, $4)', [
          randomId('cmt'),
          postId,
          userResults[comment.author]!.id,
          comment.text,
        ]);
      }
    }
    boardResults[board.key] = {
      id: boardId,
      path: `/b/${boardId}`,
      share_path: linkToken ? `/s/${linkToken}` : null,
      embed_path: linkToken && board.privacy === 'public' ? `/embed/${linkToken}` : null,
      sections: sectionIds,
      posts: postIds,
    };
  }

  sendJson(ctx.res, 201, { users: userResults, boards: boardResults });
}
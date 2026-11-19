import { randomBytes } from 'node:crypto';
import { env } from '../env.js';
import { now } from '../clock.js';
import { one, pool, query, tx } from '../db.js';
import { conflict, forbidden, gone, notFound, validation } from '../errors.js';
import { numericParam, requireViewer, route, sendJson } from '../http.js';
import { mails, sendMail } from '../mail.js';
import { publish, viewerList } from '../live.js';
import { recordBoardChange } from '../domain/changes.js';
import { serializeBoard } from '../domain/boards.js';
import { boardOrder, containerCount, renumber } from '../domain/pins.js';
import {
  findBoard,
  requireEditableBoard,
  requireOwnedBoard,
  requireVisibleBoard,
  boardVisible,
} from '../domain/visibility.js';
import {
  hasKey,
  readNumber,
  readString,
  readValue,
  requireBoardName,
  requireEmail,
  requireRole,
  requireVisibility,
  validEmail,
} from '../domain/validate.js';
import type { BoardSummary, InviteView, MemberRole, MembersResponse } from '../../shared/types.js';
import { queryWords } from '../../shared/text.js';

async function boardNameTaken(
  ownerId: number,
  name: string,
  exceptBoardId: number | null,
): Promise<boolean> {
  const row = await one<{ id: number }>(
    `select id from boards
      where owner_id = $1 and name_lower = $2 and deleted_at is null and ($3::bigint is null or id <> $3)`,
    [ownerId, name.trim().toLowerCase(), exceptBoardId],
  );
  return row !== null;
}

route('POST', '/api/boards', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rawName = readString(ctx.body, 'name');
  if (rawName !== null && rawName.trim().length > 0) {
    if (await boardNameTaken(viewer.id, rawName, null)) throw conflict('board_name_taken');
  }
  const name = requireBoardName(rawName);
  const visibility = requireVisibility(readString(ctx.body, 'visibility'));
  const created = await one<{ id: number }>(
    `insert into boards (owner_id, name, name_lower, visibility, seq, created_at)
     values ($1, $2, $3, $4, 0, $5) returning id`,
    [viewer.id, name, name.toLowerCase(), visibility, now().toISOString()],
  );
  if (!created) throw conflict('board_name_taken');
  const board = await requireVisibleBoard(pool, created.id, viewer.id);
  sendJson(ctx.res, 201, await serializeBoard(pool, board, viewer.id));
});

route('GET', '/api/boards/mine', async (ctx) => {
  const viewer = requireViewer(ctx);
  const rows = await query<BoardSummary & { last_saved_at: Date | null }>(
    `select b.id, b.name, b.visibility, b.last_saved_at,
            (select count(*)::int from pins p where p.board_id = b.id and p.state = 'live') as pin_count
       from boards b
       left join board_members m on m.board_id = b.id and m.user_id = $1
      where b.deleted_at is null and (b.owner_id = $1 or m.role = 'editor')
      order by b.last_saved_at desc nulls last, b.id asc`,
    [viewer.id],
  );
  const needle = (ctx.url.searchParams.get('q') ?? '').trim().toLowerCase();
  const filtered =
    needle.length === 0
      ? rows
      : rows.filter((board) =>
          queryWords(board.name).some((word) => word.startsWith(needle)),
        );
  sendJson(ctx.res, 200, {
    boards: filtered.map((board) => ({
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      pin_count: board.pin_count,
    })),
  });
});

route('GET', '/api/boards/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const board = await requireVisibleBoard(pool, numericParam(ctx, 'id'), viewer.id);
  sendJson(ctx.res, 200, await serializeBoard(pool, board, viewer.id));
});

route('PATCH', '/api/boards/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const board = await requireOwnedBoard(pool, boardId, viewer.id);
  const rawName = readString(ctx.body, 'name');
  if (rawName !== null && rawName.trim().length > 0) {
    if (await boardNameTaken(viewer.id, rawName, boardId)) throw conflict('board_name_taken');
  }
  const name = hasKey(ctx.body, 'name') ? requireBoardName(rawName) : board.name;
  const visibility = hasKey(ctx.body, 'visibility')
    ? requireVisibility(readString(ctx.body, 'visibility'))
    : board.visibility;
  let cover = board.cover_pin_id;
  if (hasKey(ctx.body, 'cover')) {
    const raw = readValue(ctx.body, 'cover');
    if (raw === null) {
      cover = null;
    } else {
      const pinId = readNumber(ctx.body, 'cover');
      if (pinId === null) throw validation('cover');
      const pin = await one<{ id: number }>(
        `select id from pins where id = $1 and board_id = $2 and state = 'live'`,
        [pinId, boardId],
      );
      if (!pin) throw validation('cover');
      cover = pinId;
    }
  }
  await tx(async (db) => {
    await db.query(
      `update boards set name = $2, name_lower = $3, visibility = $4, cover_pin_id = $5 where id = $1`,
      [boardId, name, name.toLowerCase(), visibility, cover],
    );
    await recordBoardChange(db, boardId, viewer, 'updated');
  });
  const updated = await requireVisibleBoard(pool, boardId, viewer.id);
  sendJson(ctx.res, 200, await serializeBoard(pool, updated, viewer.id));
});

route('DELETE', '/api/boards/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  await requireOwnedBoard(pool, boardId, viewer.id);
  const members = await query<{ user_id: number }>(
    'select user_id from board_members where board_id = $1',
    [boardId],
  );
  await tx(async (db) => {
    await db.query('update boards set deleted_at = $2 where id = $1', [
      boardId,
      now().toISOString(),
    ]);
    await db.query(
      `update pins set state = 'gone', deleted_at = $2
        where board_id = $1 and state in ('live', 'draft', 'deleted')`,
      [boardId, now().toISOString()],
    );
    await db.query('update sections set deleted_at = $2 where board_id = $1', [
      boardId,
      now().toISOString(),
    ]);
    await db.query('delete from follows_boards where board_id = $1', [boardId]);
    await db.query('delete from invites where board_id = $1', [boardId]);
    for (const member of members) {
      await publish({ k: 'membership', board_id: boardId, user_id: member.user_id }, db);
    }
  });
  ctx.res.writeHead(204).end();
});

route('POST', '/api/boards/:id/sections', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  await requireEditableBoard(pool, boardId, viewer.id);
  const rawName = readString(ctx.body, 'name');
  if (rawName !== null && rawName.trim().length > 0) {
    const taken = await one(
      'select id from sections where board_id = $1 and name_lower = $2 and deleted_at is null',
      [boardId, rawName.trim().toLowerCase()],
    );
    if (taken) throw conflict('section_name_taken');
  }
  const name = requireBoardName(rawName);
  const section = await tx(async (db) => {
    const count = await db.query<{ n: number }>(
      'select count(*)::int as n from sections where board_id = $1 and deleted_at is null',
      [boardId],
    );
    const position = (count.rows[0]?.n ?? 0) + 1;
    const inserted = await db.query<{ id: number; name: string; position: number }>(
      `insert into sections (board_id, name, name_lower, position) values ($1, $2, $3, $4)
       returning id, name, position`,
      [boardId, name, name.toLowerCase(), position],
    );
    const row = inserted.rows[0];
    await recordBoardChange(db, boardId, viewer, 'section_added', null, {
      id: row.id,
      name: row.name,
    });
    return row;
  });
  sendJson(ctx.res, 201, section);
});

route('PATCH', '/api/sections/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const sectionId = numericParam(ctx, 'id');
  const section = await one<{ id: number; board_id: number; position: number }>(
    'select id, board_id, position from sections where id = $1 and deleted_at is null',
    [sectionId],
  );
  if (!section) throw notFound();
  await requireEditableBoard(pool, section.board_id, viewer.id);
  const rawName = readString(ctx.body, 'name');
  if (rawName !== null && rawName.trim().length > 0) {
    const taken = await one(
      `select id from sections
        where board_id = $1 and name_lower = $2 and deleted_at is null and id <> $3`,
      [section.board_id, rawName.trim().toLowerCase(), sectionId],
    );
    if (taken) throw conflict('section_name_taken');
  }
  const name = requireBoardName(rawName);
  const updated = await tx(async (db) => {
    const result = await db.query<{ id: number; name: string; position: number }>(
      'update sections set name = $2, name_lower = $3 where id = $1 returning id, name, position',
      [sectionId, name, name.toLowerCase()],
    );
    const row = result.rows[0];
    await recordBoardChange(db, section.board_id, viewer, 'section_renamed', null, {
      id: row.id,
      name: row.name,
    });
    return row;
  });
  sendJson(ctx.res, 200, updated);
});

route('POST', '/api/boards/:id/moves', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const board = await requireEditableBoard(pool, boardId, viewer.id);
  const kind = readString(ctx.body, 'kind');
  const id = readNumber(ctx.body, 'id');
  const position = readNumber(ctx.body, 'position');
  const baseSeq = readNumber(ctx.body, 'base_seq') ?? board.seq;
  if (kind !== 'pin' && kind !== 'section') throw validation('kind');
  if (id === null) throw validation('id');
  if (position === null || !Number.isInteger(position)) throw validation('position');

  const result = await tx(async (db) => {
    if (kind === 'section') {
      const section = await db.query<{ id: number; name: string }>(
        'select id, name from sections where id = $1 and board_id = $2 and deleted_at is null',
        [id, boardId],
      );
      const row = section.rows[0];
      if (!row) throw notFound();
      const count = await db.query<{ n: number }>(
        'select count(*)::int as n from sections where board_id = $1 and deleted_at is null',
        [boardId],
      );
      const total = count.rows[0]?.n ?? 0;
      if (position < 1 || position > total) throw validation('position');
      const others = await db.query<{ id: number }>(
        `select id from sections
          where board_id = $1 and deleted_at is null and id <> $2
          order by position, id`,
        [boardId, id],
      );
      const order = others.rows.map((item) => item.id);
      order.splice(position - 1, 0, row.id);
      for (const [index, sectionId] of order.entries()) {
        await db.query('update sections set position = $2 where id = $1', [sectionId, index + 1]);
      }
      const seq = await recordBoardChange(db, boardId, viewer, 'section_moved', null, {
        id: row.id,
        name: row.name,
      });
      return { seq, rebased: baseSeq < board.seq, order: await boardOrder(db, boardId) };
    }

    const pin = await db.query<{ id: number; title: string; section_id: number | null }>(
      `select id, title, section_id from pins where id = $1 and board_id = $2 and state = 'live'`,
      [id, boardId],
    );
    const row = pin.rows[0];
    if (!row) throw notFound();
    const rawSection = readValue(ctx.body, 'section');
    let targetSection: number | null = null;
    if (typeof rawSection === 'number') {
      const section = await db.query<{ id: number }>(
        'select id from sections where id = $1 and board_id = $2 and deleted_at is null',
        [rawSection, boardId],
      );
      if (!section.rows[0]) throw notFound();
      targetSection = rawSection;
    }
    const existing = await containerCount(db, boardId, targetSection);
    const sameContainer = row.section_id === targetSection;
    const slots = sameContainer ? existing : existing + 1;
    if (position < 1 || position > slots) throw validation('position');

    await db.query(`update pins set section_id = null, position = 0 where id = $1`, [row.id]);
    if (!sameContainer) await renumber(db, boardId, row.section_id);
    const others = await db.query<{ id: number }>(
      `select id from pins
        where board_id = $1 and section_id is not distinct from $2 and state = 'live' and id <> $3
        order by position, id`,
      [boardId, targetSection, row.id],
    );
    const order = others.rows.map((item) => item.id);
    order.splice(position - 1, 0, row.id);
    for (const [index, pinId] of order.entries()) {
      await db.query('update pins set board_id = $2, section_id = $3, position = $4 where id = $1', [
        pinId,
        boardId,
        targetSection,
        index + 1,
      ]);
    }
    const seq = await recordBoardChange(db, boardId, viewer, 'moved', {
      id: row.id,
      title: row.title,
    });
    return { seq, rebased: baseSeq < board.seq, order: await boardOrder(db, boardId) };
  });
  sendJson(ctx.res, 200, result);
});

route('GET', '/api/boards/:id/viewers', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  await requireVisibleBoard(pool, boardId, viewer.id);
  sendJson(ctx.res, 200, { viewers: await viewerList(boardId) });
});

route('GET', '/api/boards/:id/members', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const board = await requireVisibleBoard(pool, boardId, viewer.id);
  const members = await query<{
    id: number;
    name: string;
    handle: string;
    role: MemberRole;
  }>(
    `select u.id, u.name, u.handle, m.role
       from board_members m join users u on u.id = m.user_id
      where m.board_id = $1
      order by m.created_at, u.id`,
    [boardId],
  );
  const body: MembersResponse = {
    owner: { id: board.owner_id, name: board.owner_name, handle: board.owner_handle },
    members: members.map((member) => ({
      user: { id: member.id, name: member.name, handle: member.handle },
      role: member.role,
    })),
    invites: [],
  };
  if (board.owner_id === viewer.id) {
    const invites = await query<{
      id: number;
      email: string;
      role: MemberRole;
      expires_at: Date;
    }>(
      `select id, email, role, expires_at from invites
        where board_id = $1 and status = 'pending' order by id`,
      [boardId],
    );
    body.invites = invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at.toISOString(),
    }));
  }
  sendJson(ctx.res, 200, body);
});

route('PATCH', '/api/boards/:id/members/:user', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const userId = numericParam(ctx, 'user');
  const board = await requireOwnedBoard(pool, boardId, viewer.id);
  if (userId === board.owner_id) throw notFound();
  const member = await one<{ role: MemberRole }>(
    'select role from board_members where board_id = $1 and user_id = $2',
    [boardId, userId],
  );
  if (!member) throw notFound();
  const role = requireRole(readString(ctx.body, 'role'));
  const user = await one<{ id: number; name: string; handle: string }>(
    'select id, name, handle from users where id = $1',
    [userId],
  );
  if (!user) throw notFound();
  await query('update board_members set role = $3 where board_id = $1 and user_id = $2', [
    boardId,
    userId,
    role,
  ]);
  await publish({ k: 'membership', board_id: boardId, user_id: userId });
  sendJson(ctx.res, 200, { user, role });
});

route('DELETE', '/api/boards/:id/members/:user', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const userId = numericParam(ctx, 'user');
  const board = await requireVisibleBoard(pool, boardId, viewer.id);
  if (userId === board.owner_id) throw notFound();
  const member = await one<{ role: MemberRole }>(
    'select role from board_members where board_id = $1 and user_id = $2',
    [boardId, userId],
  );
  if (!member) throw notFound();
  if (board.owner_id !== viewer.id && userId !== viewer.id) throw forbidden();
  await query('delete from board_members where board_id = $1 and user_id = $2', [boardId, userId]);
  await query('delete from board_viewers where board_id = $1 and user_id = $2', [boardId, userId]);
  await publish({ k: 'membership', board_id: boardId, user_id: userId });
  await publish({ k: 'viewers', board_id: boardId });
  ctx.res.writeHead(204).end();
});

route('POST', '/api/boards/:id/invites', async (ctx) => {
  const viewer = requireViewer(ctx);
  const boardId = numericParam(ctx, 'id');
  const board = await requireOwnedBoard(pool, boardId, viewer.id);
  const candidate = validEmail(readString(ctx.body, 'email'));
  if (candidate !== null) {
    const lower = candidate.toLowerCase();
    const member = await one(
      `select u.id from users u
         left join board_members m on m.board_id = $1 and m.user_id = u.id
        where u.email_lower = $2 and (m.user_id is not null or u.id = $3)`,
      [boardId, lower, board.owner_id],
    );
    if (member) throw conflict('already_member');
  }
  const email = requireEmail(readString(ctx.body, 'email'));
  const role = requireRole(readString(ctx.body, 'role'));
  const token = randomBytes(32).toString('base64url');
  const at = now();
  await tx(async (db) => {
    await db.query(
      `update invites set status = 'revoked'
        where board_id = $1 and email_lower = $2 and status = 'pending'`,
      [boardId, email.toLowerCase()],
    );
    await db.query(
      `insert into invites (board_id, inviter_id, email, email_lower, role, token, status, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
      [
        boardId,
        viewer.id,
        email,
        email.toLowerCase(),
        role,
        token,
        at.toISOString(),
        new Date(at.getTime() + env.inviteTtlSeconds * 1000).toISOString(),
      ],
    );
  });
  sendMail(mails.invite(email, viewer.name, board.name, role, token));
  sendJson(ctx.res, 202, { status: 'sent', email });
});

route('DELETE', '/api/invites/:id', async (ctx) => {
  const viewer = requireViewer(ctx);
  const inviteId = numericParam(ctx, 'id');
  const invite = await one<{ id: number; board_id: number; status: string }>(
    'select id, board_id, status from invites where id = $1',
    [inviteId],
  );
  if (!invite) throw notFound();
  const board = await findBoard(pool, invite.board_id, viewer.id);
  if (!board || !boardVisible(board, viewer.id)) throw notFound();
  if (board.owner_id !== viewer.id) throw forbidden();
  if (invite.status !== 'pending') throw conflict('invite_not_pending');
  await query(`update invites set status = 'revoked' where id = $1`, [inviteId]);
  ctx.res.writeHead(204).end();
});

interface InviteRow {
  id: number;
  board_id: number;
  board_name: string;
  inviter_name: string;
  owner_id: number;
  owner_email: string;
  email_lower: string;
  role: MemberRole;
  status: 'pending' | 'accepted' | 'revoked';
  expires_at: Date;
}

async function loadInvite(token: string): Promise<InviteRow | null> {
  return one<InviteRow>(
    `select i.id, i.board_id, b.name as board_name, u.name as inviter_name,
            b.owner_id, o.email as owner_email,
            i.email_lower, i.role, i.status, i.expires_at
       from invites i
       join boards b on b.id = i.board_id and b.deleted_at is null
       join users u on u.id = i.inviter_id
       join users o on o.id = b.owner_id
      where i.token = $1`,
    [token],
  );
}

route(
  'GET',
  '/api/invites/:token',
  async (ctx) => {
    const invite = await loadInvite(ctx.params.token);
    if (!invite) throw notFound();
    const expired = now().getTime() >= invite.expires_at.getTime();
    const status: InviteView['status'] =
      invite.status === 'pending' && expired ? 'expired' : invite.status;
    const body: InviteView = {
      board: { id: invite.board_id, name: invite.board_name },
      inviter: { name: invite.inviter_name },
      role: invite.role,
      status,
      expires_at: invite.expires_at.toISOString(),
    };
    sendJson(ctx.res, 200, body);
  },
  { auth: false },
);

route('POST', '/api/invites/:token/accept', async (ctx) => {
  const viewer = requireViewer(ctx);
  const invite = await loadInvite(ctx.params.token);
  if (!invite) throw notFound();
  if (invite.email_lower !== viewer.email.toLowerCase()) throw forbidden();
  if (invite.status === 'accepted') throw gone('invite_used');
  if (invite.status === 'revoked') throw gone('invite_revoked');
  if (now().getTime() >= invite.expires_at.getTime()) throw gone('invite_expired');
  await tx(async (db) => {
    await db.query(
      `insert into board_members (board_id, user_id, role, created_at) values ($1, $2, $3, $4)
       on conflict (board_id, user_id) do update set role = excluded.role`,
      [invite.board_id, viewer.id, invite.role, now().toISOString()],
    );
    await db.query(`update invites set status = 'accepted' where id = $1`, [invite.id]);
    await publish({ k: 'membership', board_id: invite.board_id, user_id: viewer.id }, db);
  });
  sendMail(mails.joined(invite.owner_email, viewer.name, invite.board_name));
  sendJson(ctx.res, 200, { board_id: invite.board_id, role: invite.role });
});

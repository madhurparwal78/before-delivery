import type { FastifyPluginAsync } from 'fastify';
import { fail, failures, isValidOpaqueId } from './errors.js';
import { parseJsonBody, loadSession, requireAuth } from './sessions.js';
import type { WorkerRuntime } from '../worker-runtime.js';
import { checkKeys, trimName } from '../rules.js';
import { newId } from '../ids.js';
import type { BoardAccess } from '../store.js';
import type { Role } from '../../shared/protocol.js';

function isRole(value: unknown): value is Role {
  return value === 'observer' || value === 'member' || value === 'admin';
}

function unknownKeyFields(keys: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of keys) fields[key] = 'Not a valid field.';
  return fields;
}

export const boardRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.get('/api/boards/:boardId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    const payload = await runtime.store.boardPayload(access, authed.session.userId);
    reply.send(payload);
  });

  app.patch('/api/boards/:boardId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: [], optional: ['name', 'visibility'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (!('name' in body) && !('visibility' in body)) fail(failures.validation({ body: 'Provide a change.' }));
    let name = access.board.name;
    if ('name' in body) {
      const parsed = trimName(body.name, 60);
      if (!parsed) fail(failures.validation({ name: 'Give the board a name.' }));
      name = parsed;
    }
    let visibility = access.board.visibility;
    if ('visibility' in body) {
      if (body.visibility !== 'workspace' && body.visibility !== 'private') {
        fail(failures.validation({ visibility: 'Choose who can see the board.' }));
      }
      visibility = body.visibility;
    }
    if (name === access.board.name && visibility === access.board.visibility) fail(failures.noChange());
    const changedVisibility = visibility !== access.board.visibility;
    await runtime.store.transaction(async (client) => {
      await client.query(`UPDATE kinfold_boards SET name = $1, visibility = $2 WHERE board_id = $3`, [
        name,
        visibility,
        boardId,
      ]);
      if (changedVisibility) {
        await runtime.store.insertPermissionLog(client, {
          workspaceId: access.board.workspaceId,
          actorId: authed.session.userId,
          action: 'board.visibility_changed',
          targetType: 'board',
          targetId: boardId,
          boardId,
          before: access.board.visibility,
          after: visibility,
        });
      }
    });
    if (changedVisibility) {
      await runtime.relay.publishBoard(boardId, { boardId, kind: 'board.updated', boardName: name, boardVisibility: visibility });
    }
    reply.send({ board: { id: boardId, name, visibility } });
  });

  app.get('/api/boards/:boardId/members', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    const members = await runtime.store.boardMembersView(boardId, access.role);
    reply.send({ members });
  });

  app.get('/api/boards/:boardId/candidates', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const people = await runtime.store.pool.query(
      `SELECT u.user_id, u.display_name FROM kinfold_workspace_members m
       JOIN kinfold_users u ON u.user_id = m.user_id
       WHERE m.workspace_id = $1 ORDER BY u.display_name`,
      [access.board.workspaceId],
    );
    // Candidates hold no current observer, member or admin role; removed people qualify again.
    const held = await runtime.store.pool.query(
      `SELECT user_id FROM kinfold_board_members WHERE board_id = $1 AND role <> 'removed'`, [boardId]);
    const heldSet = new Set((held.rows as { user_id: string }[]).map((r) => r.user_id));
    const candidates = (people.rows as { user_id: string; display_name: string }[])
      .filter((p) => !heldSet.has(p.user_id))
      .map((p) => ({ userId: p.user_id, displayName: p.display_name }));
    reply.send({ people: candidates });
  });

  app.post('/api/boards/:boardId/members', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['userId', 'role'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (typeof body.userId !== 'string' || !isRole(body.role)) {
      fail(failures.validation({ userId: 'Choose a person.', role: 'Choose a role.' }));
    }
    const wsRole = await runtime.store.workspaceMemberRole(access.board.workspaceId, body.userId);
    if (!wsRole) fail(failures.notFound());
    const current = await runtime.store.boardMembership(boardId, body.userId);
    if (current) fail(failures.alreadyMember());
    await runtime.store.transaction(async (client) => {
      await client.query(
        `INSERT INTO kinfold_board_members (board_id, user_id, role) VALUES ($1,$2,$3)`,
        [boardId, body.userId, body.role],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId: access.board.workspaceId,
        actorId: authed.session.userId,
        action: 'board.member_added',
        targetType: 'user',
        targetId: body.userId as string,
        boardId,
        before: 'none',
        after: body.role as string,
      });
    });
    const person = await runtime.store.userById(body.userId);
    const member = {
      displayName: person?.displayName ?? '',
      initials: person?.initials ?? '',
      colour: person?.colour ?? 'sage',
      userId: body.userId,
      role: body.role,
      phone: person?.phone ?? undefined,
      email: person?.email ?? '',
    };
    await runtime.relay.publishUser(body.userId, {
      kind: 'access',
      userId: body.userId,
      workspaceId: access.board.workspaceId,
      boardIds: [boardId],
    });
    reply.status(201).send({ member });
  });

  app.patch('/api/boards/:boardId/members/:userId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId, userId } = request.params as { boardId: string; userId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['role'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (!isRole(body.role)) fail(failures.validation({ role: 'Choose a role.' }));
    const wsRole = await runtime.store.workspaceMemberRole(access.board.workspaceId, userId);
    if (!wsRole) fail(failures.notFound());
    const current = await runtime.store.boardMembership(boardId, userId);
    if (!current) fail(failures.notFound());
    if (current.role === body.role) fail(failures.noChange());
    if (current.role === 'admin') {
      const admins = await runtime.store.countBoardAdmins(boardId);
      if (admins <= 1) fail(failures.lastAdmin());
    }
    await runtime.store.transaction(async (client) => {
      await client.query(
        `UPDATE kinfold_board_members SET role = $1 WHERE board_id = $2 AND user_id = $3`,
        [body.role, boardId, userId],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId: access.board.workspaceId,
        actorId: authed.session.userId,
        action: 'board.role_changed',
        targetType: 'user',
        targetId: userId,
        boardId,
        before: current.role,
        after: body.role as string,
      });
    });
    const person = await runtime.store.userById(userId);
    await runtime.relay.publishUser(userId, {
      kind: 'access',
      userId,
      workspaceId: access.board.workspaceId,
      boardIds: [boardId],
    });
    reply.send({
      member: {
        displayName: person?.displayName ?? '',
        initials: person?.initials ?? '',
        colour: person?.colour ?? 'sage',
        userId,
        role: body.role,
        phone: person?.phone ?? undefined,
        email: person?.email ?? '',
      },
    });
  });

  app.delete('/api/boards/:boardId/members/:userId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId, userId } = request.params as { boardId: string; userId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const current = await runtime.store.boardMembership(boardId, userId);
    if (!current) fail(failures.noChange());
    if (current.role === 'admin') {
      const admins = await runtime.store.countBoardAdmins(boardId);
      if (admins <= 1) fail(failures.lastAdmin());
    }
    await runtime.store.transaction(async (client) => {
      await client.query(
        `UPDATE kinfold_board_members SET role = 'removed' WHERE board_id = $1 AND user_id = $2`,
        [boardId, userId],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId: access.board.workspaceId,
        actorId: authed.session.userId,
        action: 'board.member_removed',
        targetType: 'user',
        targetId: userId,
        boardId,
        before: current.role,
        after: 'removed',
      });
    });
    await runtime.relay.publishUser(userId, {
      kind: 'access',
      userId,
      workspaceId: access.board.workspaceId,
      boardIds: [boardId],
    });
    reply.status(204).send();
  });

  app.post('/api/boards/:boardId/lists', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['name'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const name = trimName(body.name, 40);
    if (!name) fail(failures.validation({ name: 'Give the list a name.' }));
    const listId = newId('list');
    await runtime.store.transaction(async (client) => {
      const maxPos = await client.query(
        `SELECT COALESCE(MAX(position), 0)::int AS max FROM kinfold_lists WHERE board_id = $1`, [boardId]);
      await client.query(
        `INSERT INTO kinfold_lists (list_id, board_id, name, position) VALUES ($1,$2,$3,$4)`,
        [listId, boardId, name, ((maxPos.rows[0] as { max: number }).max ?? 0) + 1],
      );
    });
    await runtime.relay.publishBoard(boardId, { boardId, kind: 'list.created', listId, listName: name });
    reply.status(201).send({ list: { id: listId, name, count: 0, cards: [] } });
  });

  app.patch('/api/lists/:listId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { listId } = request.params as { listId: string };
    const list = await runtime.store.listById(listId);
    if (!list) fail(failures.notFound());
    const access = await requireBoardAccessRuntime(runtime, authed, list.boardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['name'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const name = trimName(body.name, 40);
    if (!name) fail(failures.validation({ name: 'Give the list a name.' }));
    await runtime.store.pool.query(`UPDATE kinfold_lists SET name = $1 WHERE list_id = $2`, [name, listId]);
    await runtime.relay.publishBoard(list.boardId, { boardId: list.boardId, kind: 'list.updated', listId, listName: name });
    reply.send({ list: { id: listId, name } });
  });

  app.get('/api/boards/:boardId/archived', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    const access = await requireBoardAccessRuntime(runtime, authed, boardId);
    if (access.role === 'observer') fail(failures.forbidden());
    const rows = await runtime.store.pool.query(
      `SELECT card_id FROM kinfold_cards WHERE board_id = $1 AND status = 'archived' ORDER BY archived_at DESC`,
      [boardId],
    );
    const ids = (rows.rows as { card_id: string }[]).map((r) => r.card_id);
    const today = await runtime.todayFor(access);
    const shaped = await runtime.store.shapeCards(ids, access.role, today, new Map());
    const cards = ids.map((id) => shaped.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    reply.send({ cards });
  });
};

async function requireBoardAccessRuntime(
  runtime: WorkerRuntime,
  authed: { session: { userId: string } },
  boardId: string,
): Promise<BoardAccess> {
  if (!isValidOpaqueId(boardId)) fail(failures.notFound());
  const access = await runtime.store.boardAccess(boardId, authed.session.userId);
  if (!access) fail(failures.notFound());
  return access;
}

export { requireBoardAccessRuntime, isRole, unknownKeyFields };

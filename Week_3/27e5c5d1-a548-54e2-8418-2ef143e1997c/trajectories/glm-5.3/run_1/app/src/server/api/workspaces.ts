import type { FastifyPluginAsync } from 'fastify';
import { fail, failures } from './errors.js';
import { parseJsonBody, loadSession, requireAuth } from './sessions.js';
import type { WorkerRuntime } from '../worker-runtime.js';
import { checkKeys, codePointLength, trimName } from '../rules.js';
import { newId } from '../ids.js';

export const workspaceRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.get('/api/workspaces/:workspaceId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    reply.send({
      id: workspace.workspaceId,
      name: workspace.name,
      parentName: workspace.parentName,
      timeZone: workspace.timeZone,
      role: workspace.role,
    });
  });

  app.patch('/api/workspaces/:workspaceId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: [], optional: ['timeZone'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (typeof body.timeZone !== 'string') {
      fail(failures.validation({ body: 'Provide the time zone.' }));
    }
    const timeZone = body.timeZone;
    const valid = await runtime.store.pool.query(`SELECT 1 FROM pg_timezone_names WHERE name = $1`, [timeZone]);
    if ((valid.rows as unknown[]).length === 0) {
      fail(failures.validation({ timeZone: 'Use a known time zone.' }));
    }
    await runtime.store.pool.query(`UPDATE kinfold_workspaces SET time_zone = $1 WHERE workspace_id = $2`, [timeZone, workspaceId]);
    reply.send({
      id: workspace.workspaceId,
      name: workspace.name,
      parentName: workspace.parentName,
      timeZone,
      role: workspace.role,
    });
  });

  app.get('/api/workspaces/:workspaceId/members', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    const members = await runtime.store.workspacePeopleView(workspaceId, workspace.role === 'admin');
    reply.send({ members });
  });

  app.post('/api/workspaces/:workspaceId/members', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['displayName', 'email', 'password', 'role'], optional: ['phone'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const displayName = trimName(body.displayName, 60);
    if (!displayName) fail(failures.validation({ displayName: 'Give the person a name.' }));
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      fail(failures.validation({ email: 'Give a valid email address.' }));
    }
    const email = body.email;
    if (typeof body.password !== 'string' || codePointLength(body.password) < 12 || codePointLength(body.password) > 200) {
      fail(failures.validation({ password: 'Use 12 to 200 characters.' }));
    }
    if (body.role !== 'admin' && body.role !== 'member') {
      fail(failures.validation({ role: 'Choose admin or member.' }));
    }
    if (body.phone !== undefined && (typeof body.phone !== 'string' || codePointLength(body.phone) > 30)) {
      fail(failures.validation({ phone: 'Keep the phone to 30 characters or fewer.' }));
    }
    const existing = await runtime.store.userByEmail(email);
    if (existing) fail(failures.emailTaken());
    const colour = await runtime.store.nextColourForWorkspace(workspaceId);
    const { hashPassword } = await import('../ids.js');
    const passwordHash = await hashPassword(body.password as string);
    const userId = newId('user');
    await runtime.store.transaction(async (client) => {
      const initials = displayName
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const initialText =
        initials.length === 1
          ? initials[0]!.slice(0, 1).toUpperCase()
          : (initials[0]!.slice(0, 1) + initials[initials.length - 1]!.slice(0, 1)).toUpperCase();
      await client.query(
        `INSERT INTO kinfold_users (user_id, display_name, email, email_lower, password_hash, phone, colour, initials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, displayName, email, email.toLowerCase(), passwordHash, (body.phone as string | undefined) ?? null, colour, initialText],
      );
      await client.query(
        `INSERT INTO kinfold_workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)`,
        [workspaceId, userId, body.role],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId,
        actorId: authed.session.userId,
        action: 'workspace.member_added',
        targetType: 'user',
        targetId: userId,
        boardId: null,
        before: null,
        after: body.role as string,
      });
    });
    reply.status(201);
    reply.send({
      member: {
        userId,
        displayName,
        initials: (await runtime.store.userById(userId))?.initials ?? '',
        colour,
        role: body.role,
        email,
        phone: (body.phone as string | undefined) ?? undefined,
      },
    });
  });

  app.patch('/api/workspaces/:workspaceId/members/:userId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const target = await runtime.store.workspaceMemberRole(workspaceId, userId);
    if (!target) fail(failures.notFound());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: [], optional: ['role'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (body.role !== 'admin' && body.role !== 'member') {
      fail(failures.validation({ role: 'Choose admin or member.' }));
    }
    if (body.role === target) fail(failures.noChange());
    if (target === 'admin') {
      const admins = await runtime.store.countWorkspaceAdmins(workspaceId);
      if (admins <= 1) fail(failures.lastAdmin());
    }
    await runtime.store.transaction(async (client) => {
      await client.query(
        `UPDATE kinfold_workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
        [body.role, workspaceId, userId],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId,
        actorId: authed.session.userId,
        action: 'workspace.role_changed',
        targetType: 'user',
        targetId: userId,
        boardId: null,
        before: target,
        after: body.role as string,
      });
    });
    const person = await runtime.store.userById(userId);
    const boards = await runtime.store.pool.query(
      `SELECT board_id FROM kinfold_board_members WHERE user_id = $1 AND role = 'admin'`, [userId]);
    for (const row of boards.rows as { board_id: string }[]) {
      await runtime.relay.publishUser(userId, {
        kind: 'access', userId, workspaceId, boardIds: [row.board_id],
      });
    }
    reply.send({
      member: {
        userId,
        displayName: person?.displayName ?? '',
        initials: person?.initials ?? '',
        colour: person?.colour ?? 'sage',
        role: body.role as 'admin' | 'member',
        email: person?.email ?? '',
        phone: person?.phone ?? undefined,
      },
    });
  });

  app.delete('/api/workspaces/:workspaceId/members/:userId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const target = await runtime.store.workspaceMemberRole(workspaceId, userId);
    if (!target) fail(failures.notFound());
    const admins = await runtime.store.countWorkspaceAdmins(workspaceId);
    if (target === 'admin' && admins <= 1) fail(failures.lastAdmin());
    const boards = await runtime.store.pool.query(
      `SELECT board_id FROM kinfold_board_members WHERE user_id = $1 AND role = 'admin'`, [userId]);
    for (const row of boards.rows as { board_id: string }[]) {
      const boardAdmins = await runtime.store.countBoardAdmins(row.board_id);
      if (boardAdmins <= 1) fail(failures.lastAdmin());
    }
    await runtime.store.transaction(async (client) => {
      const boardsHeld = await client.query(
        `SELECT board_id, role FROM kinfold_board_members WHERE user_id = $1`, [userId]);
      for (const row of boardsHeld.rows as { board_id: string; role: string }[]) {
        await client.query(
          `UPDATE kinfold_board_members SET role = 'removed' WHERE board_id = $1 AND user_id = $2`,
          [row.board_id, userId]);
        // removal from the workspace ends every board membership they hold in it
        await runtime.store.insertPermissionLog(client, {
          workspaceId, actorId: authed.session.userId, action: 'board.member_removed',
          targetType: 'user', targetId: userId, boardId: row.board_id,
          before: row.role, after: 'removed',
        });
      }
      await client.query(`DELETE FROM kinfold_workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
      await runtime.store.insertPermissionLog(client, {
        workspaceId, actorId: authed.session.userId, action: 'workspace.member_removed',
        targetType: 'user', targetId: userId, boardId: null,
        before: target, after: null,
      });
    });
    reply.status(204).send();
  });

  app.get('/api/workspaces/:workspaceId/boards', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    const boards = await runtime.store.boardSummaries(authed.session.userId, workspaceId);
    reply.send({ boards });
  });

  app.post('/api/workspaces/:workspaceId/boards', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['name', 'visibility'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const name = trimName(body.name, 60);
    if (!name) fail(failures.validation({ name: 'Give the board a name.' }));
    if (body.visibility !== 'workspace' && body.visibility !== 'private') {
      fail(failures.validation({ visibility: 'Choose who can see the board.' }));
    }
    const boardId = newId('board');
    await runtime.store.transaction(async (client) => {
      await client.query(
        `INSERT INTO kinfold_boards (board_id, workspace_id, name, visibility) VALUES ($1,$2,$3,$4)`,
        [boardId, workspaceId, name, body.visibility],
      );
      await client.query(
        `INSERT INTO kinfold_board_members (board_id, user_id, role) VALUES ($1,$2,'admin')`,
        [boardId, authed.session.userId],
      );
      await runtime.store.insertPermissionLog(client, {
        workspaceId,
        actorId: authed.session.userId,
        action: 'board.member_added',
        targetType: 'user',
        targetId: authed.session.userId,
        boardId,
        before: 'none',
        after: 'admin',
      });
    });
    reply.status(201).send({ board: { id: boardId, name, visibility: body.visibility } });
  });

  app.get('/api/workspaces/:workspaceId/search', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    const query = (request.query as { q?: string }).q;
    if (typeof query !== 'string') {
      fail(failures.validation({ q: 'Type at least two characters.' }));
    }
    const length = codePointLength(query);
    if (length < 2 || length > 100) {
      fail(failures.validation({ q: 'Search uses 2 to 100 characters.' }));
    }
    const boards = await runtime.store.boardSummaries(authed.session.userId, workspaceId);
    const results: { cardId: string; boardId: string; boardName: string; listName: string; title: string }[] = [];
    let total = 0;
    for (const board of boards) {
      const access = await runtime.store.boardAccess(board.id, authed.session.userId);
      if (!access) continue;
      const rows = await runtime.store.pool.query(
        `SELECT c.card_id, c.title, c.notes, c.list_id FROM kinfold_cards c
         WHERE c.board_id = $1 AND c.status <> 'archived'`,
        [board.id],
      );
      const cards = rows.rows as { card_id: string; title: string; notes: string; list_id: string }[];
      const visible = await runtime.store.visibleCardIds(access, authed.session.userId, cards.map((c) => c.card_id));
      const lower = query.toLowerCase();
      for (const card of cards) {
        if (!visible.has(card.card_id)) continue;
        const inTitle = card.title.toLowerCase().includes(lower);
        const inNotes = access.role !== 'observer' ? card.notes.toLowerCase().includes(lower) : false;
        if (!inTitle && !inNotes) continue;
        total += 1;
        if (results.length < 50) {
          const list = await runtime.store.listById(card.list_id);
          results.push({
            cardId: card.card_id,
            boardId: board.id,
            boardName: board.name,
            listName: list?.name ?? '',
            title: card.title,
          });
        }
      }
    }
    reply.send({ results, total });
  });

  app.get('/api/workspaces/:workspaceId/permission-log', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { workspaceId } = request.params as { workspaceId: string };
    const workspace = await runtime.store.workspaceById(authed.session.userId, workspaceId);
    if (!workspace) fail(failures.notFound());
    if (workspace.role !== 'admin') fail(failures.forbidden());
    const rows = await runtime.store.pool.query(
      `SELECT e.entry_id, e.at, e.action, e.target_type, e.target_id, e.board_id, e.before, e.after,
              au.display_name AS actor_name, e.actor_id AS actor_id, tu.display_name AS target_user_name,
              b.name AS board_name, c.title AS card_title,
              pb.visibility AS board_visibility, pbm.role AS reader_board_role
       FROM kinfold_permission_log e
       JOIN kinfold_users au ON au.user_id = e.actor_id
       LEFT JOIN kinfold_users tu ON tu.user_id = e.target_id
       LEFT JOIN kinfold_boards b ON b.board_id = e.board_id
       LEFT JOIN kinfold_cards c ON c.card_id = e.target_id AND e.target_type = 'card'
       LEFT JOIN kinfold_boards pb ON pb.board_id = e.board_id
       LEFT JOIN kinfold_board_members pbm ON pbm.board_id = e.board_id AND pbm.user_id = $2
       WHERE e.workspace_id = $1
       ORDER BY e.at DESC`,
      [workspaceId, authed.session.userId],
    );
    const entries = [];
    for (const row of rows.rows as {
      entry_id: string; at: Date; action: string; target_type: string; target_id: string; actor_id: string;
      board_id: string | null; before: string | null; after: string | null;
      actor_name: string; target_user_name: string | null; board_name: string | null;
      card_title: string | null; board_visibility: string | null; reader_board_role: string | null;
    }[]) {
      let label: string;
      if (row.target_type === 'user') label = row.target_user_name ?? '';
      else if (row.target_type === 'board') label = row.board_name ?? '';
      else label = row.card_title ?? '';
      let boardName: string | null = row.board_name;
      let cardLabel = label;
      if (row.target_type === 'card' && row.card_title) {
        const readerAccess = row.board_id
          ? await runtime.store.boardAccess(row.board_id, authed.session.userId)
          : null;
        const cardVisible = readerAccess ? await runtime.store.canSeeCard(readerAccess, authed.session.userId, row.target_id) : false;
        if (!cardVisible) cardLabel = 'Private card';
      }
      if (row.target_type === 'board' && row.board_visibility === 'private' && row.reader_board_role === null && label === row.board_name) {
        label = 'Private board';
        boardName = 'Private board';
      }
      entries.push({
        id: row.entry_id,
        at: row.at.toISOString(),
        actor: { userId: row.actor_id, displayName: row.actor_name },
        action: row.action,
        target: { type: row.target_type, id: row.target_id, label: row.target_type === 'card' ? cardLabel : label },
        board: row.board_id ? { id: row.board_id, name: boardName ?? '' } : null,
        before: row.before,
        after: row.after,
      });
    }
    reply.send({ entries });
  });
};

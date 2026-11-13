import type { FastifyPluginAsync } from 'fastify';
import { fail, failures, isValidOpaqueId } from './errors.js';
import { parseJsonBody, loadSession, requireAuth } from './sessions.js';
import type { WorkerRuntime } from '../worker-runtime.js';
import { allowedStatusChange, checkKeys, normaliseLabels, trimTitle, isStaleWrite, codePointLength } from '../rules.js';
import { newId } from '../ids.js';
import type { BoardAccess } from '../store.js';
import type { PoolClient } from 'pg';
import type { Card, CardStatus } from '../../shared/protocol.js';
import { unknownKeyFields } from './boards.js';

async function requireCardAccess(
  runtime: WorkerRuntime,
  userId: string,
  cardId: string,
): Promise<{ access: BoardAccess; card: { id: string; boardId: string; listId: string; status: string; version: number; rank: number } }> {
  if (!isValidOpaqueId(cardId)) fail(failures.notFound());
  const card = await runtime.store.cardById(cardId);
  if (!card) fail(failures.notFound());
  const access = await runtime.store.boardAccess(card.boardId, userId);
  if (!access) fail(failures.notFound());
  const visible = await runtime.store.canSeeCard(access, userId, cardId);
  if (!visible) fail(failures.notFound());
  return { access, card };
}

/** Whether the caller's role allows editing; observers only read. */
function requireEditable(access: BoardAccess): void {
  if (access.role === 'observer') fail(failures.forbidden());
}

async function staleReply(
  runtime: WorkerRuntime,
  access: BoardAccess,
  userId: string,
  card: { id: string },
  change: 'moved' | 'edited',
): Promise<never> {
  const today = await runtime.todayFor(access);
  const positions = await runtime.visiblePositions(access, userId);
  const shaped = (await runtime.store.shapeCards([card.id], access.role, today, positions)).get(card.id);
  if (!shaped) fail(failures.notFound());
  const lastRow = await runtime.store.pool.query(
    `SELECT last_versioned_by, u.display_name FROM kinfold_cards c
     LEFT JOIN kinfold_users u ON u.user_id = c.last_versioned_by WHERE c.card_id = $1`,
    [card.id],
  );
  const changedBy = ((lastRow.rows[0] as { display_name: string | null } | undefined)?.display_name) ?? 'Someone';
  fail(failures.stale(shaped, { displayName: changedBy }, change));
}

/** Dense ranks: place a card before the visible card holding the requested position. */
async function placeCard(
  runtime: WorkerRuntime,
  access: BoardAccess,
  userId: string,
  cardId: string,
  toListId: string,
  position: number,
  client: PoolClient,
): Promise<void> {
  const exec: PoolClient = client;
  const rows = await exec.query(
    `SELECT card_id, rank FROM kinfold_cards WHERE list_id = $1 AND status <> 'archived' AND card_id <> $2 ORDER BY rank`,
    [toListId, cardId],
  );
  const listCards = rows.rows as { card_id: string; rank: number }[];
  const visible = await runtime.store.visibleCardIds(access, userId, listCards.map((c) => c.card_id));
  const visibleOrdered = listCards.filter((c) => visible.has(c.card_id));
  const maxVisible = visibleOrdered.length;
  if (position < 1 || position > maxVisible + 1) {
    fail(failures.validation({ position: 'Choose a position in the list.' }));
  }
  let targetRank: number;
  if (position > maxVisible) {
    targetRank = listCards.length === 0 ? 1 : listCards[listCards.length - 1]!.rank + 1;
  } else {
    const beforeCard = visibleOrdered[position - 1]!;
    const beforeIndex = listCards.findIndex((c) => c.card_id === beforeCard.card_id);
    const beforeRank = listCards[beforeIndex]!.rank;
    const previousRank = beforeIndex > 0 ? listCards[beforeIndex - 1]!.rank : 0;
    if (beforeRank - previousRank > 1) {
      targetRank = previousRank + 1;
    } else {
      // No gap: shift the rest of the list to open a slot, keeping ranks dense and unique.
      await exec.query(
        `UPDATE kinfold_cards SET rank = rank + 1 WHERE list_id = $1 AND rank >= $2 AND card_id <> $3`,
        [toListId, beforeRank, cardId],
      );
      targetRank = beforeRank;
    }
  }
  await exec.query(`UPDATE kinfold_cards SET list_id = $1, rank = $2 WHERE card_id = $3`, [
    toListId,
    targetRank,
    cardId,
  ]);
  await normaliseRanks(runtime, toListId, exec);
}

/** Every list's ranks stay dense and unique: the one place ranks are renumbered. */
async function normaliseRanks(runtime: WorkerRuntime, listId: string, client?: PoolClient): Promise<void> {
  const exec = client ?? runtime.store.pool;
  await exec.query(
    `WITH ordered AS (
       SELECT card_id, ROW_NUMBER() OVER (ORDER BY rank) AS rn
       FROM kinfold_cards WHERE list_id = $1 AND status <> 'archived'
     )
     UPDATE kinfold_cards c SET rank = o.rn FROM ordered o WHERE c.card_id = o.card_id`,
    [listId],
  );
}

async function writeReply(
  runtime: WorkerRuntime,
  access: BoardAccess,
  userId: string,
  cardId: string,
  listIds: string[],
): Promise<Record<string, unknown>> {
  const today = await runtime.todayFor(access);
  const positions = await runtime.visiblePositions(access, userId);
  const card = (await runtime.store.shapeCards([cardId], access.role, today, positions)).get(cardId);
  if (!card) fail(failures.notFound());
  const counts = await runtime.store.listCounts(access, userId, listIds);
  const openCards = await runtime.store.openCardCount(access, userId);
  return { card, counts, openCards };
}

export const cardRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.post('/api/lists/:listId/cards', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { listId } = request.params as { listId: string };
    if (!isValidOpaqueId(listId)) fail(failures.notFound());
    const list = await runtime.store.listById(listId);
    if (!list) fail(failures.notFound());
    const access = await runtime.store.boardAccess(list.boardId, authed.session.userId);
    if (!access) fail(failures.notFound());
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['title'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const title = trimTitle(body.title);
    if (!title) fail(failures.validation({ title: 'Give the card a title.' }));
    const idempotencyKey = request.headers['idempotency-key'];
    const keyText = typeof idempotencyKey === 'string' ? idempotencyKey : null;
    if (keyText !== null) {
      if (keyText.length < 1 || keyText.length > 100) {
        fail(failures.validation({ 'Idempotency-Key': 'Use 1 to 100 characters.' }));
      }
      const existing = await runtime.store.pool.query(
        `SELECT list_id, title, response_json FROM kinfold_idempotency_keys WHERE key_id = $1 AND user_id = $2`,
        [keyText, authed.session.userId],
      );
      const row = existing.rows[0] as { list_id: string; title: string; response_json: string } | undefined;
      if (row) {
        if (row.list_id !== listId || row.title !== title) fail(failures.idempotencyConflict());
        reply.header('Idempotent-Replay', 'true');
        reply.status(201).send(JSON.parse(row.response_json));
        return;
      }
    }
    const cardId = newId('card');
    await runtime.store.transaction(async (client) => {
      const maxRank = await client.query(
        `SELECT COALESCE(MAX(rank), 0)::int AS max FROM kinfold_cards WHERE list_id = $1 AND status <> 'archived'`,
        [listId],
      );
      await client.query(
        `INSERT INTO kinfold_cards (card_id, board_id, list_id, title, rank, last_versioned_by, last_versioned_change)
         VALUES ($1,$2,$3,$4,$5,$6,'created')`,
        [cardId, list.boardId, listId, title, ((maxRank.rows[0] as { max: number }).max ?? 0) + 1, authed.session.userId],
      );
      if (keyText !== null) {
        await client.query(
          `INSERT INTO kinfold_idempotency_keys (key_id, user_id, list_id, title, response_json) VALUES ($1,$2,$3,$4,$5)`,
          [keyText, authed.session.userId, listId, title, JSON.stringify({ pending: true })],
        );
      }
    });
    const payload = await writeReply(runtime, access, authed.session.userId, cardId, [listId]);
    if (keyText !== null) {
      await runtime.store.pool.query(
        `UPDATE kinfold_idempotency_keys SET response_json = $1 WHERE key_id = $2 AND user_id = $3`,
        [JSON.stringify(payload), keyText, authed.session.userId],
      );
    }
    await runtime.relay.publishBoard(list.boardId, {
      boardId: list.boardId,
      kind: 'card.created',
      cardId,
      toListId: listId,
    });
    reply.status(201).send(payload);
  });

  app.get('/api/cards/:cardId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    if (card.status === 'archived' && access.role === 'observer') fail(failures.notFound());
    const today = await runtime.todayFor(access);
    const positions = await runtime.visiblePositions(access, authed.session.userId);
    const shaped = (await runtime.store.shapeCards([cardId], access.role, today, positions)).get(cardId);
    if (!shaped) fail(failures.notFound());
    reply.send({ card: shaped });
  });

  app.patch('/api/cards/:cardId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['version'], optional: ['title', 'notes', 'dueDate', 'labels', 'ownerUserId'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (card.status === 'archived') fail(failures.archived());
    const fields: { title?: string; notes?: string; dueDate?: string | null; labels?: string[]; ownerUserId?: string | null } = {};
    if ('title' in body) {
      const title = trimTitle(body.title);
      if (!title) fail(failures.validation({ title: 'Give the card a title.' }));
      fields.title = title;
    }
    if ('notes' in body) {
      if (typeof body.notes !== 'string' || codePointLength(body.notes) > 4000) {
        fail(failures.validation({ notes: 'Keep notes to 4,000 characters or fewer.' }));
      }
      fields.notes = body.notes;
    }
    if ('dueDate' in body) {
      if (body.dueDate === null) {
        fields.dueDate = null;
      } else if (typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
        fields.dueDate = body.dueDate;
      } else {
        fail(failures.validation({ dueDate: 'Use a date.' }));
      }
    }
    if ('labels' in body) {
      const labels = normaliseLabels(body.labels);
      if (!labels) fail(failures.validation({ labels: 'Choose from the labels.' }));
      fields.labels = labels;
    }
    if ('ownerUserId' in body) {
      if (body.ownerUserId === null) {
        fields.ownerUserId = null;
      } else if (typeof body.ownerUserId === 'string') {
        if (!isValidOpaqueId(body.ownerUserId)) fail(failures.notFound());
        const ownerRole = await runtime.store.boardMembership(card.boardId, body.ownerUserId);
        if (ownerRole && ownerRole.role === 'observer') {
          fail(failures.validation({ ownerUserId: 'Choose a member or admin of this board.' }));
        }
        if (!ownerRole) {
          const wsRole = await runtime.store.workspaceMemberRole(access.board.workspaceId, body.ownerUserId);
          if (!wsRole) fail(failures.notFound());
          fail(failures.validation({ ownerUserId: 'Choose a member or admin of this board.' }));
        }
        fields.ownerUserId = body.ownerUserId;
      } else {
        fail(failures.validation({ ownerUserId: 'Choose an owner.' }));
      }
    }
    await runtime.store.transaction(async (client) => {
      // Lock the card row: a stale write is refused even when it touches other fields.
      const locked = await client.query(
        `SELECT version, status FROM kinfold_cards WHERE card_id = $1 FOR UPDATE`,
        [cardId],
      );
      const row = locked.rows[0] as { version: number; status: string } | undefined;
      if (!row) return { stale: false, gone: true };
      if (row.status === 'archived') return { stale: false, gone: false, archived: true };
      if (isStaleWrite(row.version, body.version)) return { stale: true, gone: false };
      await client.query(
        `UPDATE kinfold_cards SET
           title = COALESCE($1, title),
           notes = COALESCE($2, notes),
           due_date = CASE WHEN $3::boolean THEN $4::date ELSE due_date END,
           labels = COALESCE($5, labels),
           owner_user_id = CASE WHEN $6::boolean THEN $7 ELSE owner_user_id END,
           version = version + 1,
           last_versioned_by = $8,
           last_versioned_change = 'edited'
         WHERE card_id = $9`,
        [
          fields.title ?? null,
          fields.notes ?? null,
          'dueDate' in body,
          fields.dueDate ?? null,
          fields.labels ?? null,
          'ownerUserId' in body,
          fields.ownerUserId ?? null,
          authed.session.userId,
          cardId,
        ],
      );
      return { stale: false, gone: false };
    }).then((lockResult: { stale: boolean; gone: boolean; archived?: boolean }) => {
      if (lockResult.archived) fail(failures.archived());
      if (lockResult.stale) {
        return staleReply(runtime, access, authed.session.userId, card, 'edited');
      }
      return undefined;
    });
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.changed',
      cardId,
      fromListId: card.listId,
    });
    const today = await runtime.todayFor(access);
    const positions = await runtime.visiblePositions(access, authed.session.userId);
    const shaped = (await runtime.store.shapeCards([cardId], access.role, today, positions)).get(cardId);
    if (!shaped) fail(failures.notFound());
    reply.send({ card: shaped });
  });

  app.post('/api/cards/:cardId/move', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['toListId', 'position', 'version'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (typeof body.toListId !== 'string' || !isValidOpaqueId(body.toListId)) fail(failures.notFound());
    const targetList = await runtime.store.listById(body.toListId);
    if (!targetList || targetList.boardId !== card.boardId) fail(failures.notFound());
    if (typeof body.position !== 'number' || !Number.isInteger(body.position)) {
      fail(failures.validation({ position: 'Choose a position in the list.' }));
    }
    const fromListId = card.listId;
    const fromPositionRow = await runtime.visiblePositions(access, authed.session.userId);
    const fromPosition = fromPositionRow.get(cardId) ?? 1;
    const result = await runtime.store.transaction(async (client) => {
      // Lock the card row so same-version writes on either worker have exactly one winner.
      const locked = await client.query(
        `SELECT version, status, list_id FROM kinfold_cards WHERE card_id = $1 FOR UPDATE`,
        [cardId],
      );
      const row = locked.rows[0] as { version: number; status: string; list_id: string } | undefined;
      if (!row) return { stale: false, notFound: true, status: 'open' as const, version: 1, listId: fromListId };
      if (row.status === 'archived') return { stale: false, notFound: false, status: 'archived' as const, version: row.version, listId: row.list_id };
      if (isStaleWrite(row.version, body.version)) {
        return { stale: true, notFound: false, status: 'open' as const, version: row.version, listId: row.list_id };
      }
      await placeCard(runtime, access, authed.session.userId, cardId, body.toListId as string, body.position as number, client);
      await client.query(
        `UPDATE kinfold_cards SET version = version + 1, last_versioned_by = $1, last_versioned_change = 'moved' WHERE card_id = $2`,
        [authed.session.userId, cardId],
      );
      return { stale: false, notFound: false, status: 'open' as const, version: row.version + 1, listId: body.toListId };
    });
    if (result.status === 'archived') fail(failures.archived());
    if (result.stale) {
      await staleReply(runtime, access, authed.session.userId, card, 'moved');
    }
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.moved',
      cardId,
      fromListId,
      fromPosition,
      toListId: body.toListId,
      moverUserId: authed.session.userId,
    });
    const payload = await writeReply(runtime, access, authed.session.userId, cardId, [fromListId, body.toListId]);
    reply.send(payload);
  });

  app.post('/api/cards/:cardId/status', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['status', 'version'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const to = body.status;
    if (to !== 'open' && to !== 'done' && to !== 'archived') {
      fail(failures.validation({ status: 'Choose open, done or archived.' }));
    }
    const fromListId = card.listId;
    const statusResult = await runtime.store.transaction(async (client) => {
      const locked = await client.query(
        `SELECT version, status, list_id FROM kinfold_cards WHERE card_id = $1 FOR UPDATE`,
        [cardId],
      );
      const row = locked.rows[0] as { version: number; status: string; list_id: string } | undefined;
      if (!row) return { outcome: 'gone' as const };
      if (isStaleWrite(row.version, body.version)) return { outcome: 'stale' as const };
      if (!allowedStatusChange(row.status as CardStatus, to)) {
        return { outcome: 'invalid' as const, from: row.status, to };
      }
      if (to === 'archived') {
        await client.query(
          `UPDATE kinfold_cards SET status = 'archived', archived_at = now(), rank = NULL WHERE card_id = $1`,
          [cardId],
        );
      } else if (row.status === 'archived') {
        // A restore places the card last in its list.
        const maxRank = await client.query(
          `SELECT COALESCE(MAX(rank), 0)::int AS max FROM kinfold_cards WHERE list_id = $1 AND status <> 'archived'`,
          [row.list_id],
        );
        await client.query(
          `UPDATE kinfold_cards SET status = 'open', archived_at = NULL, rank = $1 WHERE card_id = $2`,
          [((maxRank.rows[0] as { max: number }).max ?? 0) + 1, cardId],
        );
      } else {
        await client.query(`UPDATE kinfold_cards SET status = $1, archived_at = NULL WHERE card_id = $2`, [to, cardId]);
      }
      await client.query(
        `UPDATE kinfold_cards SET version = version + 1, last_versioned_by = $1, last_versioned_change = 'edited' WHERE card_id = $2`,
        [authed.session.userId, cardId],
      );
      return { outcome: 'ok' as const };
    });
    if (statusResult.outcome === 'stale') {
      await staleReply(runtime, access, authed.session.userId, card, 'edited');
    }
    if (statusResult.outcome === 'gone') fail(failures.notFound());
    if (statusResult.outcome === 'invalid') {
      fail(failures.invalidTransition(statusResult.from, statusResult.to));
    }
    if (to === 'archived') {
      await normaliseRanks(runtime, fromListId);
    }
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: to === 'archived' ? 'card.removed' : 'card.changed',
      cardId,
      fromListId,
    });
    const payload = await writeReply(runtime, access, authed.session.userId, cardId, [fromListId]);
    reply.send(payload);
  });

  app.put('/api/cards/:cardId/private-members', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['userIds'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (!Array.isArray(body.userIds)) fail(failures.validation({ userIds: 'Choose the people who can see this card.' }));
    const userIds: string[] = [];
    for (const id of body.userIds) {
      if (typeof id !== 'string' || !isValidOpaqueId(id)) fail(failures.validation({ userIds: 'Choose the people who can see this card.' }));
      userIds.push(id);
    }
    for (const id of userIds) {
      const membership = await runtime.store.boardMembership(card.boardId, id);
      if (!membership || membership.role === 'observer') fail(failures.validation({ userIds: 'Choose members or admins of this board.' }));
    }
    if (userIds.length > 0 && !userIds.includes(authed.session.userId)) {
      fail(failures.validation({ userIds: 'Include yourself in the people who can see this card.' }));
    }
    const currentRow = await runtime.store.pool.query(
      `SELECT u.display_name, pm.user_id FROM kinfold_card_private_members pm
       JOIN kinfold_users u ON u.user_id = pm.user_id WHERE pm.card_id = $1 ORDER BY u.display_name`,
      [cardId],
    );
    const current = (currentRow.rows as { display_name: string; user_id: string }[]).map((r) => r.display_name);
    const targetRow = await runtime.store.pool.query(
      `SELECT display_name FROM kinfold_users WHERE user_id = ANY($1::text[]) ORDER BY display_name`,
      [userIds],
    );
    const target = (targetRow.rows as { display_name: string }[]).map((r) => r.display_name);
    const same = current.length === target.length && current.every((v, i) => v === target[i]);
    if (same) fail(failures.noChange());
    await runtime.store.transaction(async (client) => {
      await client.query(`DELETE FROM kinfold_card_private_members WHERE card_id = $1`, [cardId]);
      for (const id of userIds) {
        await client.query(`INSERT INTO kinfold_card_private_members (card_id, user_id) VALUES ($1,$2)`, [cardId, id]);
      }
      await runtime.store.insertPermissionLog(client, {
        workspaceId: access.board.workspaceId,
        actorId: authed.session.userId,
        action: 'card.private_members_changed',
        targetType: 'card',
        targetId: cardId,
        boardId: card.boardId,
        before: JSON.stringify(current),
        after: JSON.stringify(target),
      });
    });
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.changed',
      cardId,
      fromListId: card.listId,
    });
    const today = await runtime.todayFor(access);
    const positions = await runtime.visiblePositions(access, authed.session.userId);
    const shaped = (await runtime.store.shapeCards([cardId], access.role, today, positions)).get(cardId);
    if (!shaped) fail(failures.notFound());
    reply.send({ card: shaped });
  });

  app.delete('/api/cards/:cardId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    if (access.role !== 'admin') fail(failures.forbidden());
    const attachments = await runtime.store.pool.query(
      `SELECT attachment_id FROM kinfold_attachments WHERE card_id = $1`, [cardId]);
    const keys = (attachments.rows as { attachment_id: string }[]).map(
      (r) => `attachments/${access.board.workspaceId}/${cardId}/${r.attachment_id}`,
    );
    if (keys.length > 0) {
      if (!runtime.storage.isUp()) fail(failures.storageUnavailable());
      try {
        await runtime.storage.removeObjects(keys);
      } catch {
        fail(failures.storageUnavailable());
      }
    }
    await runtime.store.pool.query(`DELETE FROM kinfold_cards WHERE card_id = $1`, [cardId]);
    await normaliseRanks(runtime, card.listId);
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.removed',
      cardId,
      fromListId: card.listId,
    });
    reply.status(204).send();
  });

  app.post('/api/cards/:cardId/checklist', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    const { access, card } = await requireCardAccess(runtime, authed.session.userId, cardId);
    requireEditable(access);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['text'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (card.status === 'archived') fail(failures.archived());
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || codePointLength(text) > 200) fail(failures.validation({ text: 'Give the item some text.' }));
    const itemId = newId('chk');
    const maxPos = await runtime.store.pool.query(
      `SELECT COALESCE(MAX(position), 0)::int AS max FROM kinfold_checklist_items WHERE card_id = $1`, [cardId]);
    await runtime.store.pool.query(
      `INSERT INTO kinfold_checklist_items (item_id, card_id, text, done, position) VALUES ($1,$2,$3,FALSE,$4)`,
      [itemId, cardId, text, ((maxPos.rows[0] as { max: number }).max ?? 0) + 1],
    );
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.changed',
      cardId,
      fromListId: card.listId,
    });
    reply.status(201).send({ item: { id: itemId, text, done: false } });
  });

  app.patch('/api/checklist-items/:itemId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { itemId } = request.params as { itemId: string };
    if (!isValidOpaqueId(itemId)) fail(failures.notFound());
    const row = await runtime.store.pool.query(
      `SELECT ci.item_id, ci.card_id, c.board_id, c.list_id, c.status FROM kinfold_checklist_items ci
       JOIN kinfold_cards c ON c.card_id = ci.card_id WHERE ci.item_id = $1`,
      [itemId],
    );
    const item = row.rows[0] as { item_id: string; card_id: string; board_id: string; list_id: string; status: string } | undefined;
    if (!item) fail(failures.notFound());
    const { access } = await requireCardAccess(runtime, authed.session.userId, item.card_id);
    requireEditable(access);
    if (item.status === 'archived') fail(failures.archived());
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: [], optional: ['text', 'done'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) fail(failures.validation(unknownKeyFields(keys.unknownKeys)));
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    if (!('text' in body) && !('done' in body)) fail(failures.validation({ body: 'Provide a change.' }));
    if ('text' in body) {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || codePointLength(text) > 200) fail(failures.validation({ text: 'Give the item some text.' }));
      await runtime.store.pool.query(`UPDATE kinfold_checklist_items SET text = $1 WHERE item_id = $2`, [text, itemId]);
    }
    if ('done' in body) {
      if (typeof body.done !== 'boolean') fail(failures.validation({ done: 'Tick or untick the item.' }));
      await runtime.store.pool.query(`UPDATE kinfold_checklist_items SET done = $1 WHERE item_id = $2`, [body.done, itemId]);
    }
    await runtime.relay.publishBoard(item.board_id, {
      boardId: item.board_id,
      kind: 'card.changed',
      cardId: item.card_id,
      fromListId: item.list_id,
    });
    const updated = await runtime.store.pool.query(
      `SELECT item_id AS id, text, done FROM kinfold_checklist_items WHERE item_id = $1`, [itemId]);
    reply.send({ item: updated.rows[0] as { id: string; text: string; done: boolean } });
  });

  app.delete('/api/checklist-items/:itemId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { itemId } = request.params as { itemId: string };
    if (!isValidOpaqueId(itemId)) fail(failures.notFound());
    const row = await runtime.store.pool.query(
      `SELECT ci.item_id, ci.card_id, c.board_id, c.list_id, c.status FROM kinfold_checklist_items ci
       JOIN kinfold_cards c ON c.card_id = ci.card_id WHERE ci.item_id = $1`,
      [itemId],
    );
    const item = row.rows[0] as { item_id: string; card_id: string; board_id: string; list_id: string; status: string } | undefined;
    if (!item) fail(failures.notFound());
    const { access } = await requireCardAccess(runtime, authed.session.userId, item.card_id);
    requireEditable(access);
    if (item.status === 'archived') fail(failures.archived());
    await runtime.store.pool.query(`DELETE FROM kinfold_checklist_items WHERE item_id = $1`, [itemId]);
    await runtime.relay.publishBoard(item.board_id, {
      boardId: item.board_id,
      kind: 'card.changed',
      cardId: item.card_id,
      fromListId: item.list_id,
    });
    reply.status(204).send();
  });
};

export type { Card };

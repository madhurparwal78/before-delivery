import { COPY } from '../../shared/copy';
import {
  LABELS,
  type BoardRole,
  type CardPayload,
  type CardStatus,
  type CardWriteReply,
  type Label,
} from '../../shared/types';
import { transaction, type Tx } from '../db/pool';
import {
  db,
  loadBoard,
  loadCard,
  loadList,
  lockBoard,
  type BoardRow,
  type CardRecord,
  type Reader,
  type UserRow,
} from '../db/repo';
import { canEditCards, canSeeCard } from '../domain/access';
import {
  readEnum,
  readId,
  readIdList,
  readInteger,
  readNullableString,
  readText,
  type Body,
} from '../domain/body';
import { loadSnapshot, roleOnBoard } from '../domain/boardService';
import { contentDisposition, isStorableFilename } from '../domain/attachments';
import { canTransition, highestRequestablePosition, placementIndex } from '../domain/cardRules';
import { writeLogEntry } from '../domain/permissionLog';
import type { Viewer } from '../domain/snapshot';
import { publishBoardSignal, type BoardSignal, type PreMoveCard } from '../events/live';
import type { Ctx } from '../http/context';
import { errors } from '../http/errors';
import { newId } from '../lib/crypto';
import { storage, StorageDown } from '../services/storage';

interface CardAccess {
  user: UserRow;
  board: BoardRow;
  role: BoardRole;
  viewer: Viewer;
  card: CardRecord;
}

async function requireCard(ctx: Ctx, reader: Reader, cardId: string, mode: 'read' | 'write'): Promise<CardAccess> {
  const user = ctx.requireUser();
  const card = await loadCard(reader, cardId);
  if (card === null) throw errors.notFound();
  const board = await loadBoard(reader, card.boardId);
  if (board === null) throw errors.notFound();
  const role = await roleOnBoard(reader, board, user.id);
  if (role === null) throw errors.notFound();
  const visible = canSeeCard(
    role,
    card.privateMembers.map((member) => member.userId),
    user.id,
  );
  if (!visible) throw errors.notFound();
  if (card.status === 'archived' && !canEditCards(role)) throw errors.notFound();
  if (mode === 'write' && !canEditCards(role)) throw errors.forbidden();
  return { user, board, role, viewer: { userId: user.id, role }, card };
}

async function cardReply(
  tx: Tx,
  boardId: string,
  cardId: string,
  viewer: Viewer,
  listIds: string[],
): Promise<CardWriteReply> {
  const snapshot = await loadSnapshot(tx, boardId);
  if (snapshot === null) throw errors.internal();
  const card = snapshot.cardById(cardId);
  if (card === undefined) throw errors.internal();
  return {
    card: snapshot.cardPayload(card, viewer),
    counts: snapshot.counts(listIds, viewer),
    openCards: snapshot.openCards(viewer),
  };
}

/** The one place that refuses a write carrying anything but the card's current version. */
function assertFresh(card: CardRecord, version: number, shaped: CardPayload): void {
  if (card.version === version) return;
  throw errors.stale(shaped, card.lastChangedBy ?? 'Someone', card.lastChange);
}

async function staleReply(tx: Tx, access: CardAccess): Promise<CardPayload> {
  const snapshot = await loadSnapshot(tx, access.board.id);
  if (snapshot === null) throw errors.internal();
  const card = snapshot.cardById(access.card.id);
  if (card === undefined) throw errors.internal();
  return snapshot.cardPayload(card, access.viewer);
}

interface ListEntry {
  id: string;
  privateTo: string[];
}

async function listEntries(tx: Tx, listId: string): Promise<ListEntry[]> {
  const rows = await tx.query<{ id: string; private_to: string[] }>(
    `select c.id,
            coalesce(array_agg(p.user_id) filter (where p.user_id is not null), '{}') as private_to
       from cards c left join card_private_members p on p.card_id = c.id
      where c.list_id = $1 and c.status <> 'archived'
      group by c.id, c.position
      order by c.position, c.id`,
    [listId],
  );
  return rows.map((row) => ({ id: row.id, privateTo: row.private_to }));
}

async function renumber(tx: Tx, ids: readonly string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await tx.query(`update cards set position = $1 where id = $2`, [index + 1, ids[index]]);
  }
}

function visibleTo(entry: ListEntry, viewer: Viewer): boolean {
  return canSeeCard(viewer.role, entry.privateTo, viewer.userId);
}

export async function createCard(ctx: Ctx): Promise<void> {
  const user = ctx.requireUser();
  const listId = ctx.id('listId');
  const list = await loadList(db, listId);
  if (list === null) throw errors.notFound();
  const board = await loadBoard(db, list.board_id);
  if (board === null) throw errors.notFound();
  const role = await roleOnBoard(db, board, user.id);
  if (role === null) throw errors.notFound();
  if (!canEditCards(role)) throw errors.forbidden();
  const body = ctx.body({ required: ['title'] });
  const title = readText(body, 'title', {
    min: 1,
    max: 120,
    tooShort: COPY.cardTitleRequired,
    tooLong: COPY.cardTitleTooLong,
  });
  const key = ctx.header('Idempotency-Key');
  if (key !== null && (key.length < 1 || key.length > 100)) {
    throw errors.validation({ 'Idempotency-Key': 'Use 1 to 100 characters.' });
  }
  const viewer: Viewer = { userId: user.id, role };

  const outcome = await transaction(async (tx) => {
    await lockBoard(tx, board.id);
    if (key !== null) {
      const claimed = await tx.query<{ key: string }>(
        `insert into idempotency_keys (user_id, key, list_id, title) values ($1, $2, $3, $4)
         on conflict (user_id, key) do nothing returning key`,
        [user.id, key, listId, title],
      );
      if (claimed.length === 0) {
        const stored = await tx.queryOne<{ list_id: string; title: string; response: unknown }>(
          `select list_id, title, response from idempotency_keys where user_id = $1 and key = $2`,
          [user.id, key],
        );
        if (stored === null || stored.list_id !== listId || stored.title !== title) {
          throw errors.idempotencyConflict();
        }
        return { replay: true, body: stored.response, cardId: null };
      }
    }
    const cardId = newId();
    const last = await tx.queryOne<{ position: number }>(
      `select coalesce(max(position), 0) as position from cards where list_id = $1 and status <> 'archived'`,
      [listId],
    );
    await tx.query(
      `insert into cards (id, board_id, list_id, title, position, last_change, last_changed_by)
       values ($1, $2, $3, $4, $5, 'edited', $6)`,
      [cardId, board.id, listId, title, (last?.position ?? 0) + 1, user.id],
    );
    const reply = await cardReply(tx, board.id, cardId, viewer, [listId]);
    if (key !== null) {
      await tx.query(`update idempotency_keys set response = $1 where user_id = $2 and key = $3`, [
        JSON.stringify(reply),
        user.id,
        key,
      ]);
    }
    return { replay: false, body: reply, cardId };
  });

  if (outcome.cardId !== null) {
    publishBoardSignal(board.id, { type: 'card.created', cardId: outcome.cardId, listIds: [listId] });
  }
  ctx.json(201, outcome.body, outcome.replay ? { 'Idempotent-Replay': 'true' } : {});
}

export async function readCard(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const access = await requireCard(ctx, db, cardId, 'read');
  const snapshot = await loadSnapshot(db, access.board.id);
  if (snapshot === null) throw errors.notFound();
  const card = snapshot.cardById(cardId);
  if (card === undefined) throw errors.notFound();
  ctx.json(200, { card: snapshot.cardPayload(card, access.viewer) });
}

function readLabels(body: Body): Label[] {
  const value = body['labels'];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw errors.validation({ labels: 'Choose labels from the published list.' });
  }
  const chosen = new Set(value as string[]);
  for (const label of chosen) {
    if (!LABELS.includes(label as Label)) {
      throw errors.validation({ labels: 'Choose labels from the published list.' });
    }
  }
  return LABELS.filter((label) => chosen.has(label));
}

function readDueDate(body: Body): string | null {
  const value = readNullableString(body, 'dueDate', 'Use a date like 2026-03-04.');
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw errors.validation({ dueDate: 'Use a date like 2026-03-04.' });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw errors.validation({ dueDate: 'Use a date like 2026-03-04.' });
  }
  return value;
}

export async function patchCard(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const reply = await transaction(async (tx) => {
    const access = await requireCard(ctx, tx, cardId, 'write');
    await lockBoard(tx, access.board.id);
    const fresh = await requireCard(ctx, tx, cardId, 'write');
    const body = ctx.body({
      required: ['version'],
      optional: ['title', 'notes', 'dueDate', 'labels', 'ownerUserId'],
      requireOneOptional: true,
    });
    const version = readInteger(body, 'version', 'Send the card version you edited.');
    if (fresh.card.status === 'archived') throw errors.archived();
    assertFresh(fresh.card, version, await staleReply(tx, fresh));

    const updates: string[] = [];
    const params: unknown[] = [];
    if ('title' in body) {
      params.push(
        readText(body, 'title', {
          min: 1,
          max: 120,
          tooShort: COPY.cardTitleRequired,
          tooLong: COPY.cardTitleTooLong,
        }),
      );
      updates.push(`title = $${params.length}`);
    }
    if ('notes' in body) {
      params.push(
        readText(body, 'notes', {
          min: 0,
          max: 4000,
          trim: false,
          tooShort: 'Keep the notes to 4,000 characters or fewer.',
          tooLong: 'Keep the notes to 4,000 characters or fewer.',
        }),
      );
      updates.push(`notes = $${params.length}`);
    }
    if ('dueDate' in body) {
      params.push(readDueDate(body));
      updates.push(`due_date = $${params.length}`);
    }
    if ('labels' in body) {
      params.push(readLabels(body));
      updates.push(`labels = $${params.length}`);
    }
    if ('ownerUserId' in body) {
      const ownerUserId = body['ownerUserId'] === null ? null : readId(body, 'ownerUserId');
      if (ownerUserId !== null) {
        const inWorkspace = await tx.queryOne<{ user_id: string }>(
          `select user_id from workspace_members where workspace_id = $1 and user_id = $2`,
          [access.board.workspace_id, ownerUserId],
        );
        if (inWorkspace === null) throw errors.notFound();
        const onBoard = await tx.queryOne<{ state: string }>(
          `select state from board_members where board_id = $1 and user_id = $2 and state in ('member','admin')`,
          [access.board.id, ownerUserId],
        );
        if (onBoard === null) throw errors.validation({ ownerUserId: 'Choose someone who works on this board.' });
      }
      params.push(ownerUserId);
      updates.push(`owner_user_id = $${params.length}`);
    }
    params.push(access.user.id);
    updates.push(`last_changed_by = $${params.length}`);
    params.push(cardId);
    await tx.query(
      `update cards set ${updates.join(', ')}, version = version + 1, last_change = 'edited' where id = $${params.length}`,
      params,
    );
    return cardReply(tx, access.board.id, cardId, access.viewer, [access.card.listId]);
  });
  publishBoardSignal(reply.card.boardId, { type: 'card.updated', cardId, listIds: [reply.card.listId] });
  ctx.json(200, { card: reply.card });
}

export async function moveCard(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const outcome = await transaction(async (tx) => {
    const first = await requireCard(ctx, tx, cardId, 'write');
    await lockBoard(tx, first.board.id);
    const access = await requireCard(ctx, tx, cardId, 'write');
    const body = ctx.body({ required: ['toListId', 'position', 'version'] });
    const toListId = readId(body, 'toListId');
    const position = readInteger(body, 'position', 'Choose a position in the list.');
    const version = readInteger(body, 'version', 'Send the card version you moved.');
    const toList = await loadList(tx, toListId);
    if (toList === null || toList.board_id !== access.board.id) throw errors.notFound();
    if (access.card.status === 'archived') throw errors.archived();
    assertFresh(access.card, version, await staleReply(tx, access));

    const fromListId = access.card.listId;
    const fromOrder = await listEntries(tx, fromListId);
    const target = (fromListId === toListId ? fromOrder : await listEntries(tx, toListId)).filter(
      (entry) => entry.id !== cardId,
    );
    const ranked = target.map((entry) => ({ id: entry.id, visible: visibleTo(entry, access.viewer) }));
    if (position < 1 || position > highestRequestablePosition(ranked)) {
      throw errors.validation({ position: 'Choose a position in the list.' });
    }
    const index = placementIndex(ranked, position);
    const nextOrder = [...target.map((entry) => entry.id)];
    nextOrder.splice(index, 0, cardId);

    await tx.query(
      `update cards set list_id = $1, version = version + 1, last_change = 'moved', last_changed_by = $2 where id = $3`,
      [toListId, access.user.id, cardId],
    );
    await renumber(tx, nextOrder);
    if (fromListId !== toListId) {
      await renumber(
        tx,
        fromOrder.filter((entry) => entry.id !== cardId).map((entry) => entry.id),
      );
    }
    const reply = await cardReply(tx, access.board.id, cardId, access.viewer, [fromListId, toListId]);
    const signal: BoardSignal = {
      type: 'card.moved',
      cardId,
      moverUserId: access.user.id,
      fromListId,
      toListId,
      fromOrder: fromOrder.map((entry): PreMoveCard => ({ id: entry.id, privateTo: entry.privateTo })),
    };
    return { reply, signal, boardId: access.board.id };
  });
  publishBoardSignal(outcome.boardId, outcome.signal);
  ctx.json(200, outcome.reply);
}

export async function changeStatus(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const outcome = await transaction(async (tx) => {
    const first = await requireCard(ctx, tx, cardId, 'write');
    await lockBoard(tx, first.board.id);
    const access = await requireCard(ctx, tx, cardId, 'write');
    const body = ctx.body({ required: ['status', 'version'] });
    const status = readEnum<CardStatus>(body, 'status', ['open', 'done', 'archived'], 'Choose a status.');
    const version = readInteger(body, 'version', 'Send the card version you changed.');
    if (!canTransition(access.card.status, status)) throw errors.invalidTransition(access.card.status, status);
    assertFresh(access.card, version, await staleReply(tx, access));

    const listId = access.card.listId;
    if (status === 'archived') {
      await tx.query(
        `update cards set status = 'archived', archived_at = now(), position = null,
                version = version + 1, last_change = 'edited', last_changed_by = $1 where id = $2`,
        [access.user.id, cardId],
      );
      const remaining = await listEntries(tx, listId);
      await renumber(
        tx,
        remaining.filter((entry) => entry.id !== cardId).map((entry) => entry.id),
      );
    } else if (access.card.status === 'archived') {
      const last = await tx.queryOne<{ position: number }>(
        `select coalesce(max(position), 0) as position from cards where list_id = $1 and status <> 'archived'`,
        [listId],
      );
      await tx.query(
        `update cards set status = 'open', archived_at = null, position = $1,
                version = version + 1, last_change = 'edited', last_changed_by = $2 where id = $3`,
        [(last?.position ?? 0) + 1, access.user.id, cardId],
      );
    } else {
      await tx.query(
        `update cards set status = $1, version = version + 1, last_change = 'edited', last_changed_by = $2 where id = $3`,
        [status, access.user.id, cardId],
      );
    }
    const reply = await cardReply(tx, access.board.id, cardId, access.viewer, [listId]);
    const signal: BoardSignal =
      status === 'archived'
        ? { type: 'card.removed', cardId, listIds: [listId] }
        : { type: 'card.updated', cardId, listIds: [listId] };
    return { reply, signal, boardId: access.board.id };
  });
  publishBoardSignal(outcome.boardId, outcome.signal);
  ctx.json(200, outcome.reply);
}

export async function setPrivateMembers(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const outcome = await transaction(async (tx) => {
    const first = await requireCard(ctx, tx, cardId, 'write');
    await lockBoard(tx, first.board.id);
    const access = await requireCard(ctx, tx, cardId, 'write');
    const body = ctx.body({ required: ['userIds'] });
    const userIds = readIdList(body, 'userIds', 'Choose people from this board.');
    const unique = [...new Set(userIds)];
    if (unique.length > 0 && !unique.includes(access.user.id)) {
      throw errors.validation({ userIds: 'Keep yourself on a private card.' });
    }
    for (const userId of unique) {
      const inWorkspace = await tx.queryOne<{ user_id: string }>(
        `select user_id from workspace_members where workspace_id = $1 and user_id = $2`,
        [access.board.workspace_id, userId],
      );
      if (inWorkspace === null) throw errors.notFound();
      const onBoard = await tx.queryOne<{ state: string }>(
        `select state from board_members where board_id = $1 and user_id = $2 and state in ('member','admin')`,
        [access.board.id, userId],
      );
      if (onBoard === null) throw errors.validation({ userIds: 'Choose people from this board.' });
    }
    const before = access.card.privateMembers.map((member) => member.displayName);
    const beforeIds = new Set(access.card.privateMembers.map((member) => member.userId));
    const sameSet = beforeIds.size === unique.length && unique.every((userId) => beforeIds.has(userId));
    if (sameSet) throw errors.noChange();

    await tx.query(`delete from card_private_members where card_id = $1`, [cardId]);
    for (const userId of unique) {
      await tx.query(`insert into card_private_members (card_id, user_id) values ($1, $2)`, [cardId, userId]);
    }
    const after = await tx.query<{ display_name: string }>(
      `select u.display_name from card_private_members p join users u on u.id = p.user_id
        where p.card_id = $1 order by u.display_name, u.id`,
      [cardId],
    );
    await writeLogEntry(tx, {
      workspaceId: access.board.workspace_id,
      actorUserId: access.user.id,
      action: 'card.private_members_changed',
      targetType: 'card',
      targetId: cardId,
      targetLabel: access.card.title,
      boardId: access.board.id,
      before,
      after: after.map((row) => row.display_name),
    });
    const reply = await cardReply(tx, access.board.id, cardId, access.viewer, [access.card.listId]);
    return { reply, boardId: access.board.id, listId: access.card.listId };
  });
  publishBoardSignal(outcome.boardId, { type: 'card.updated', cardId, listIds: [outcome.listId] });
  ctx.json(200, { card: outcome.reply.card });
}

export async function deleteCard(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const access = await requireCard(ctx, db, cardId, 'write');
  if (access.role !== 'admin') throw errors.forbidden();
  for (const attachment of access.card.attachments) {
    try {
      await storage.remove(storage.objectKey(access.board.workspace_id, cardId, attachment.id));
    } catch (error) {
      if (error instanceof StorageDown) throw errors.storageUnavailable();
      throw error;
    }
  }
  await transaction(async (tx) => {
    await lockBoard(tx, access.board.id);
    await tx.query(`delete from cards where id = $1`, [cardId]);
    const remaining = await listEntries(tx, access.card.listId);
    await renumber(
      tx,
      remaining.map((entry) => entry.id),
    );
  });
  publishBoardSignal(access.board.id, { type: 'card.removed', cardId, listIds: [access.card.listId] });
  ctx.noContent();
}

export async function addChecklistItem(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const outcome = await transaction(async (tx) => {
    const access = await requireCard(ctx, tx, cardId, 'write');
    const body = ctx.body({ required: ['text'] });
    const text = readText(body, 'text', {
      min: 1,
      max: 200,
      tooShort: COPY.checklistTextRequired,
      tooLong: 'Keep the item to 200 characters or fewer.',
    });
    if (access.card.status === 'archived') throw errors.archived();
    const last = await tx.queryOne<{ position: number }>(
      `select coalesce(max(position), 0) as position from checklist_items where card_id = $1`,
      [cardId],
    );
    const itemId = newId();
    await tx.query(`insert into checklist_items (id, card_id, text, position) values ($1, $2, $3, $4)`, [
      itemId,
      cardId,
      text,
      (last?.position ?? 0) + 1,
    ]);
    return { item: { id: itemId, text, done: false }, boardId: access.board.id, listId: access.card.listId };
  });
  publishBoardSignal(outcome.boardId, { type: 'card.updated', cardId, listIds: [outcome.listId] });
  ctx.json(201, { item: outcome.item });
}

async function requireChecklistItem(
  ctx: Ctx,
  tx: Tx,
  itemId: string,
): Promise<{ access: CardAccess; item: { id: string; text: string; done: boolean } }> {
  const row = await tx.queryOne<{ id: string; card_id: string; text: string; done: boolean }>(
    `select id, card_id, text, done from checklist_items where id = $1`,
    [itemId],
  );
  if (row === null) throw errors.notFound();
  const access = await requireCard(ctx, tx, row.card_id, 'write');
  return { access, item: { id: row.id, text: row.text, done: row.done } };
}

export async function patchChecklistItem(ctx: Ctx): Promise<void> {
  const itemId = ctx.id('itemId');
  const outcome = await transaction(async (tx) => {
    const { access, item } = await requireChecklistItem(ctx, tx, itemId);
    const body = ctx.body({ optional: ['text', 'done'], requireOneOptional: true });
    let text = item.text;
    let done = item.done;
    if ('text' in body) {
      text = readText(body, 'text', {
        min: 1,
        max: 200,
        tooShort: COPY.checklistTextRequired,
        tooLong: 'Keep the item to 200 characters or fewer.',
      });
    }
    if ('done' in body) {
      if (typeof body['done'] !== 'boolean') throw errors.validation({ done: 'Send true or false.' });
      done = body['done'];
    }
    if (access.card.status === 'archived') throw errors.archived();
    await tx.query(`update checklist_items set text = $1, done = $2 where id = $3`, [text, done, itemId]);
    return {
      item: { id: itemId, text, done },
      boardId: access.board.id,
      cardId: access.card.id,
      listId: access.card.listId,
    };
  });
  publishBoardSignal(outcome.boardId, { type: 'card.updated', cardId: outcome.cardId, listIds: [outcome.listId] });
  ctx.json(200, { item: outcome.item });
}

export async function deleteChecklistItem(ctx: Ctx): Promise<void> {
  const itemId = ctx.id('itemId');
  const outcome = await transaction(async (tx) => {
    const { access } = await requireChecklistItem(ctx, tx, itemId);
    if (access.card.status === 'archived') throw errors.archived();
    await tx.query(`delete from checklist_items where id = $1`, [itemId]);
    return { boardId: access.board.id, cardId: access.card.id, listId: access.card.listId };
  });
  publishBoardSignal(outcome.boardId, { type: 'card.updated', cardId: outcome.cardId, listIds: [outcome.listId] });
  ctx.noContent();
}

export async function uploadAttachment(ctx: Ctx): Promise<void> {
  const cardId = ctx.id('cardId');
  const access = await requireCard(ctx, db, cardId, 'write');
  const file = ctx.file;
  if (file === null || file.fieldName !== 'file') throw errors.validation({ file: 'Choose a file to attach.' });
  if (access.card.status === 'archived') throw errors.archived();
  if (!isStorableFilename(file.filename)) throw errors.validation({ file: "That file name can't be stored." });

  const attachmentId = newId();
  const key = storage.objectKey(access.board.workspace_id, cardId, attachmentId);
  try {
    await storage.put(key, file.bytes, file.contentType);
    const storedSize = await storage.storedSize(key);
    if (storedSize !== file.bytes.length) throw new StorageDown();
  } catch (error) {
    if (error instanceof StorageDown) {
      await storage.remove(key).catch(() => undefined);
      throw errors.storageUnavailable();
    }
    throw error;
  }
  const uploadedAt = await db.queryOne<{ at: string }>(
    `insert into attachments (id, card_id, workspace_id, filename, content_type, size, uploaded_by_user_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning to_char(uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [
      attachmentId,
      cardId,
      access.board.workspace_id,
      file.filename,
      file.contentType,
      file.bytes.length,
      access.user.id,
    ],
  );
  publishBoardSignal(access.board.id, { type: 'card.updated', cardId, listIds: [access.card.listId] });
  ctx.json(201, {
    attachment: {
      id: attachmentId,
      filename: file.filename,
      contentType: file.contentType,
      size: file.bytes.length,
      uploadedAt: uploadedAt?.at ?? new Date().toISOString(),
      uploadedBy: { displayName: access.user.display_name },
    },
  });
}

interface AttachmentRow {
  id: string;
  card_id: string;
  workspace_id: string;
  filename: string;
  content_type: string;
  size: string;
}

async function requireAttachment(ctx: Ctx, attachmentId: string): Promise<{ row: AttachmentRow; access: CardAccess }> {
  const row = await db.queryOne<AttachmentRow>(
    `select id, card_id, workspace_id, filename, content_type, size::text as size from attachments where id = $1`,
    [attachmentId],
  );
  if (row === null) throw errors.notFound();
  const access = await requireCard(ctx, db, row.card_id, 'read');
  if (!canEditCards(access.role)) throw errors.notFound();
  return { row, access };
}

export async function downloadAttachment(ctx: Ctx): Promise<void> {
  const { row } = await requireAttachment(ctx, ctx.id('attachmentId'));
  let bytes: Buffer;
  try {
    bytes = await storage.get(storage.objectKey(row.workspace_id, row.card_id, row.id));
  } catch (error) {
    if (error instanceof StorageDown) throw errors.storageUnavailable();
    throw error;
  }
  ctx.res.writeHead(200, {
    'Content-Type': row.content_type,
    'Content-Length': bytes.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': contentDisposition(row.filename),
  });
  ctx.res.end(bytes);
}

export async function deleteAttachment(ctx: Ctx): Promise<void> {
  const attachmentId = ctx.id('attachmentId');
  const { row, access } = await requireAttachment(ctx, attachmentId);
  if (!canEditCards(access.role)) throw errors.forbidden();
  try {
    await storage.remove(storage.objectKey(row.workspace_id, row.card_id, row.id));
  } catch (error) {
    if (error instanceof StorageDown) throw errors.storageUnavailable();
    throw error;
  }
  await db.query(`delete from attachments where id = $1`, [attachmentId]);
  publishBoardSignal(access.board.id, {
    type: 'card.updated',
    cardId: row.card_id,
    listIds: [access.card.listId],
  });
  ctx.noContent();
}

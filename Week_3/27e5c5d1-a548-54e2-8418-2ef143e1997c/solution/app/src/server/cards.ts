import { LABELS, WRITER_ROLES, isWriter, type Card, type CardStatus } from '../shared/types.ts';
import { requireAdmin, requireWrite, boardAccess } from './access.ts';
import type { Actor } from './auth.ts';
import { boardWrite, type BoardTx } from './board-tx.ts';
import { canTransition } from './card-status.ts';
import {
  canSee, countsFor, loadCard, loadSnapshot, loadWritten, openCardCount, positionOf, shapeCard, todayIn,
  type CardRec,
} from './cards-data.ts';
import { database, only, type Db, type Row } from './db.ts';
import { conflict, invalidTransition, notFound, stale, validation } from './errors.ts';
import type { Handler } from './http-types.ts';
import { recordAccessChange } from './permission-log.ts';
import { insertionIndex, renumber } from './ranks.ts';
import { objectKey, removeObject } from './storage.ts';
import { Input, boolean, codePoints, integer, isId, nullable, oneOf, plainDate, stringList, text } from './validate.ts';

const anyString = (message: string) => ({
  parse: (value: unknown) => (typeof value === 'string' ? { ok: true as const, value } : { ok: false as const, message }),
});

const titleField = text({ max: 120, empty: 'Give the card a title.', long: 'Keep the title to 120 characters or fewer.' });
const notesField = {
  parse: (value: unknown) =>
    typeof value === 'string' && codePoints(value) <= 4000
      ? { ok: true as const, value }
      : { ok: false as const, message: 'Keep the notes to 4,000 characters or fewer.' },
};
const labelsField = {
  parse: (value: unknown) => {
    const listed = stringList('Choose from the published labels.', 10).parse(value);
    if (!listed.ok || !listed.value.every((label) => (LABELS as readonly string[]).includes(label))) {
      return { ok: false as const, message: 'Choose from the published labels.' };
    }
    return { ok: true as const, value: LABELS.filter((label) => listed.value.includes(label)) };
  },
};
const versionField = integer('Send the version you last saw.');
const itemText = text({ max: 200, empty: 'Give the item some text.', long: 'Keep the item to 200 characters or fewer.' });

/** Runs a write against one card: its board is locked, and a card the caller cannot see answers 404. */
async function cardWrite<T>(actor: Actor, cardId: string, run: (tx: BoardTx, card: CardRec) => Promise<T>): Promise<T> {
  if (!isId(cardId)) throw notFound();
  const found = await database().query<Row>('SELECT board_id FROM cards WHERE id = $1', [cardId]);
  if (!found.rows[0]) throw notFound();
  return boardWrite(actor, found.rows[0]['board_id'] as string, async (tx) => {
    const card = await loadCard(tx.client, cardId);
    if (!card || card.boardId !== tx.access.board.id || !visible(card, tx)) throw notFound();
    return run(tx, card);
  });
}

function visible(card: CardRec, tx: Pick<BoardTx, 'viewer'>): boolean {
  if (card.status === 'archived' && !isWriter(tx.viewer.role)) return false;
  return canSee(card, tx.viewer);
}

/** The card as the caller now sees it, with the position the board gives it. */
async function shaped(tx: BoardTx, cardId: string): Promise<Card> {
  const snapshot = await tx.snapshot();
  const card = snapshot.cards.find((candidate) => candidate.id === cardId) ?? (await loadWritten(tx.client, cardId));
  return shapeCard(card, tx.viewer, positionOf(snapshot, card, tx.viewer), todayIn(tx.access.board.timeZone));
}

/** The stale-version check: one place, one answer carrying the card's current state and who changed it. */
function assertCurrent(tx: BoardTx, card: CardRec, version: number | undefined): void {
  if (version === undefined || version === card.version) return;
  const today = todayIn(tx.access.board.timeZone);
  throw stale(shapeCard(card, tx.viewer, positionOf(tx.before, card, tx.viewer), today), card.lastChangeBy, card.lastChange);
}

function assertNotArchived(card: CardRec): void {
  if (card.status === 'archived') throw conflict('archived');
}

/** One versioned write to a card: `set` may use $2.. for `values`; the version and last change are set here. */
async function touch(tx: BoardTx, cardId: string, change: 'moved' | 'edited', set = '', values: unknown[] = []): Promise<void> {
  const actorIndex = values.length + 2;
  await tx.client.query(
    `UPDATE cards SET version = version + 1, last_change = '${change}', last_change_by = $${actorIndex}${set ? `, ${set}` : ''} WHERE id = $1`,
    [cardId, ...values, tx.actor.userId],
  );
}

/** A card added to the end of a list takes the next rank: the list's size plus one. */
const nextRank = (tx: BoardTx, listId: string): number => tx.before.cards.filter((card) => card.listId === listId).length + 1;

/** Closes the gap a card leaves in its list: the cards that remain keep their order as ranks 1..N. */
async function closeGap(tx: BoardTx, card: CardRec): Promise<void> {
  const rest = tx.before.cards.filter((candidate) => candidate.listId === card.listId && candidate.id !== card.id);
  await renumber(tx.client, card.listId, rest.map((candidate) => candidate.id));
}

async function counts(tx: BoardTx, listIds: string[]) {
  const snapshot = await tx.snapshot();
  return { counts: countsFor(snapshot, listIds, tx.viewer), openCards: openCardCount(snapshot.cards, tx.viewer) };
}

export const getCard: Handler = async ({ actor, params }) => {
  const cardId = params[0];
  if (!isId(cardId)) throw notFound();
  const card = await loadCard(database(), cardId);
  const access = card ? await boardAccess(database(), actor.userId, card.boardId) : null;
  if (!card || !access) throw notFound();
  const viewer = { userId: actor.userId, role: access.role };
  if (!visible(card, { viewer })) throw notFound();
  const snapshot = await loadSnapshot(database(), card.boardId);
  return { status: 200, body: { card: shapeCard(card, viewer, positionOf(snapshot, card, viewer), todayIn(access.board.timeZone)) } };
};

const ownerField = nullable(anyString('Choose a member of this board.'));

export const patchCard: Handler = async ({ actor, params, body }) => {
  const input = new Input(
    body,
    { version: versionField, title: titleField, notes: notesField, dueDate: nullable(plainDate('Use a date as YYYY-MM-DD.')), labels: labelsField, ownerUserId: ownerField },
    ['version'],
    { atLeastOne: true },
  );
  const card = await cardWrite(actor, params[0], async (tx, card) => {
    const owner = input.peek('ownerUserId');
    let ownerProblem: Record<string, string> = {};
    if (typeof owner === 'string') {
      const member = await tx.client.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [tx.access.board.workspaceId, isId(owner) ? owner : null],
      );
      if (!member.rowCount) throw notFound();
      const role = await tx.client.query(
        `SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2 AND role = ANY($3::text[])`,
        [card.boardId, owner, WRITER_ROLES],
      );
      if (!role.rowCount) ownerProblem = { ownerUserId: 'Choose a member of this board.' };
    }
    requireWrite(tx.access.role);
    assertNotArchived(card);
    assertCurrent(tx, card, input.peek('version'));
    const values = input.check(ownerProblem);
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      args.push(value);
      sets.push(`${column} = $${args.length + 1}`);
    };
    if (values.title !== undefined) set('title', values.title);
    if (values.notes !== undefined) set('notes', values.notes);
    if (values.dueDate !== undefined) set('due_date', values.dueDate);
    if (values.labels !== undefined) set('labels', values.labels);
    if (values.ownerUserId !== undefined) set('owner_user_id', values.ownerUserId);
    await touch(tx, card.id, 'edited', sets.join(', '), args);
    tx.intents.push({ type: 'card', cardId: card.id });
    return shaped(tx, card.id);
  });
  return { status: 200, body: { card } };
};

export const moveCard: Handler = async ({ actor, params, body }) => {
  const input = new Input(
    body,
    { toListId: anyString('Choose a list.'), position: integer('Choose a position.'), version: versionField },
    ['toListId', 'position', 'version'],
  );
  const reply = await cardWrite(actor, params[0], async (tx, card) => {
    const target = input.peek('toListId');
    if (target !== undefined && !tx.before.lists.some((list) => list.id === target)) throw notFound();
    requireWrite(tx.access.role);
    assertNotArchived(card);
    assertCurrent(tx, card, input.peek('version'));
    const values = input.check();
    const toListId = values.toListId;
    const others = tx.before.cards.filter((candidate) => candidate.listId === toListId && candidate.id !== card.id);
    const seen = others.filter((candidate) => canSee(candidate, tx.viewer));
    const position = values.position;
    if (position < 1 || position > seen.length + 1) throw validation({ position: `Choose a position from 1 to ${seen.length + 1}.` });
    const ids = others.map((candidate) => candidate.id);
    ids.splice(insertionIndex(ids, seen.map((candidate) => candidate.id), position), 0, card.id);
    await touch(tx, card.id, 'moved');
    await renumber(tx.client, toListId, ids);
    if (card.listId !== toListId) await closeGap(tx, card);
    tx.intents.push({
      type: 'card',
      cardId: card.id,
      mover: { displayName: tx.actor.displayName, initials: tx.actor.initials, colour: tx.actor.colour },
    });
    return { card: await shaped(tx, card.id), ...(await counts(tx, [card.listId, toListId])) };
  });
  return { status: 200, body: reply };
};

const STATUSES: readonly CardStatus[] = ['open', 'done', 'archived'];

export const changeStatus: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { status: oneOf(STATUSES, 'Choose open, done or archived.'), version: versionField }, ['status', 'version']);
  const reply = await cardWrite(actor, params[0], async (tx, card) => {
    requireWrite(tx.access.role);
    assertCurrent(tx, card, input.peek('version'));
    const wanted = input.peek('status');
    if (wanted !== undefined && !canTransition(card.status, wanted)) throw invalidTransition(card.status, wanted);
    const { status } = input.check();
    if (status === 'archived') {
      await touch(tx, card.id, 'edited', `status = 'archived', rank = NULL, archived_at = clock_timestamp()`);
      await closeGap(tx, card);
    } else if (card.status === 'archived') {
      await touch(tx, card.id, 'edited', `status = 'open', rank = $2, archived_at = NULL`, [nextRank(tx, card.listId)]);
    } else {
      await touch(tx, card.id, 'edited', 'status = $2', [status]);
    }
    tx.intents.push({ type: 'card', cardId: card.id });
    return { card: await shaped(tx, card.id), ...(await counts(tx, [card.listId])) };
  });
  return { status: 200, body: reply };
};

const idList = {
  parse: (value: unknown) => {
    const listed = stringList('Choose people from this board.', 200).parse(value);
    return listed.ok ? { ok: true as const, value: [...new Set(listed.value)] } : listed;
  },
};

export const setPrivateMembers: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { userIds: idList }, ['userIds']);
  const card = await cardWrite(actor, params[0], async (tx, card) => {
    const named = input.peek('userIds');
    if (named !== undefined && named.length > 0) {
      const inWorkspace = await tx.client.query(
        'SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])',
        [tx.access.board.workspaceId, named.filter(isId)],
      );
      if (inWorkspace.rowCount !== named.length) throw notFound();
    }
    requireWrite(tx.access.role);
    let problem: Record<string, string> = {};
    let after: string[] = [];
    if (named !== undefined) {
      const members = await tx.client.query<Row>(
        `SELECT bm.user_id, u.display_name FROM board_members bm JOIN users u ON u.id = bm.user_id
          WHERE bm.board_id = $1 AND bm.role = ANY($3::text[]) AND bm.user_id = ANY($2::uuid[])`,
        [card.boardId, named, WRITER_ROLES],
      );
      if (members.rowCount !== named.length) problem = { userIds: 'Choose members of this board.' };
      else if (named.length > 0 && !named.includes(actor.userId)) problem = { userIds: 'Include yourself in the list.' };
      after = members.rows.map((row) => row['display_name'] as string).sort();
      if (named.length === card.privateMembers.length && named.every((id) => card.privateMembers.some((m) => m.userId === id))) {
        throw conflict('no_change');
      }
    }
    const { userIds } = input.check(problem);
    await tx.client.query('DELETE FROM card_private_members WHERE card_id = $1', [card.id]);
    for (const userId of userIds) await tx.client.query('INSERT INTO card_private_members (card_id, user_id) VALUES ($1,$2)', [card.id, userId]);
    await recordAccessChange(tx.client, {
      workspaceId: tx.access.board.workspaceId,
      actorId: actor.userId,
      action: 'card.private_members_changed',
      target: { type: 'card', id: card.id, label: card.title },
      boardId: card.boardId,
      before: card.privateMembers.map((m) => m.displayName).sort(),
      after,
    });
    tx.intents.push({ type: 'card', cardId: card.id });
    return shaped(tx, card.id);
  });
  return { status: 200, body: { card } };
};

export const deleteCard: Handler = async ({ actor, params }) => {
  await cardWrite(actor, params[0], async (tx, card) => {
    requireAdmin(tx.access.role);
    const files = await tx.client.query<Row>('SELECT id, workspace_id FROM attachments WHERE card_id = $1', [card.id]);
    for (const file of files.rows) await removeObject(objectKey(file['workspace_id'] as string, card.id, file['id'] as string));
    await tx.client.query('DELETE FROM cards WHERE id = $1', [card.id]);
    if (card.status !== 'archived') await closeGap(tx, card);
    tx.intents.push({ type: 'card', cardId: card.id });
  });
  return { status: 204 };
};

export const addChecklistItem: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { text: itemText }, ['text']);
  const item = await cardWrite(actor, params[0], async (tx, card) => {
    requireWrite(tx.access.role);
    assertNotArchived(card);
    const { text: itemTextValue } = input.check();
    const { rows } = await tx.client.query<Row>(
      'INSERT INTO checklist_items (card_id, text) VALUES ($1,$2) RETURNING id, text, done',
      [card.id, itemTextValue],
    );
    tx.intents.push({ type: 'card', cardId: card.id });
    return { id: only(rows)['id'] as string, text: only(rows)['text'] as string, done: only(rows)['done'] as boolean };
  });
  return { status: 201, body: { item } };
};

async function itemWrite<T>(actor: Actor, itemId: string, run: (tx: BoardTx, card: CardRec, itemId: string) => Promise<T>): Promise<T> {
  if (!isId(itemId)) throw notFound();
  const found = await database().query<Row>('SELECT card_id FROM checklist_items WHERE id = $1', [itemId]);
  if (!found.rows[0]) throw notFound();
  return cardWrite(actor, found.rows[0]['card_id'] as string, async (tx, card) => {
    if (!card.checklist.some((item) => item.id === itemId)) throw notFound();
    requireWrite(tx.access.role);
    assertNotArchived(card);
    return run(tx, card, itemId);
  });
}

export const patchChecklistItem: Handler = async ({ actor, params, body }) => {
  const input = new Input(body, { text: itemText, done: boolean('Send true or false.') }, [], { atLeastOne: true });
  const item = await itemWrite(actor, params[0], async (tx, card, itemId) => {
    const values = input.check();
    const { rows } = await tx.client.query<Row>(
      'UPDATE checklist_items SET text = COALESCE($2, text), done = COALESCE($3, done) WHERE id = $1 RETURNING id, text, done',
      [itemId, values.text ?? null, values.done ?? null],
    );
    tx.intents.push({ type: 'card', cardId: card.id });
    return { id: only(rows)['id'] as string, text: only(rows)['text'] as string, done: only(rows)['done'] as boolean };
  });
  return { status: 200, body: { item } };
};

export const deleteChecklistItem: Handler = async ({ actor, params }) => {
  await itemWrite(actor, params[0], async (tx, card, itemId) => {
    await tx.client.query('DELETE FROM checklist_items WHERE id = $1', [itemId]);
    tx.intents.push({ type: 'card', cardId: card.id });
  });
  return { status: 204 };
};

const KEY_MESSAGE = 'Use 1 to 100 characters.';

type KeyState = { state: 'new' } | { state: 'replay'; response: unknown } | { state: 'conflict' };

/** What an idempotency key means for this request: unused, a replay of the stored answer, or a different request. */
async function keyState(db: Db, userId: string, key: string, listId: string, title: unknown): Promise<KeyState> {
  const { rows } = await db.query<Row>('SELECT list_id, title, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
  const stored = rows[0];
  if (!stored) return { state: 'new' };
  return stored['list_id'] === listId && stored['title'] === title ? { state: 'replay', response: stored['response'] } : { state: 'conflict' };
}

const REPLAY = { 'Idempotent-Replay': 'true' };

export const createCard: Handler = async ({ actor, params, body, headers }) => {
  const listId = params[0];
  if (!isId(listId)) throw notFound();
  const input = new Input(body, { title: titleField }, ['title']);
  const rawKey = headers['idempotency-key'];
  const key = typeof rawKey === 'string' ? rawKey : null;
  const keyProblem: Record<string, string> = key !== null && (key.length < 1 || key.length > 100) ? { 'Idempotency-Key': KEY_MESSAGE } : {};
  const usable = key !== null && Object.keys(keyProblem).length === 0 ? key : null;
  if (usable !== null) {
    const earlier = await keyState(database(), actor.userId, usable, listId, input.peek('title'));
    if (earlier.state === 'replay') return { status: 201, body: earlier.response, headers: REPLAY };
  }
  const owner = await database().query<Row>('SELECT board_id FROM lists WHERE id = $1', [listId]);
  const boardId = owner.rows[0]?.['board_id'];
  if (typeof boardId !== 'string') throw notFound();
  const outcome = await boardWrite<{ body: unknown; replay: boolean }>(actor, boardId, async (tx) => {
    requireWrite(tx.access.role);
    if (usable !== null) {
      const raced = await keyState(tx.client, actor.userId, usable, listId, input.peek('title'));
      if (raced.state === 'replay') return { body: raced.response, replay: true };
      if (raced.state === 'conflict') throw conflict('idempotency_conflict');
    }
    const { title } = input.check(keyProblem);
    const { rows } = await tx.client.query<Row>(
      `INSERT INTO cards (board_id, list_id, title, rank, last_change_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tx.access.board.id, listId, title, nextRank(tx, listId), actor.userId],
    );
    const cardId = only(rows)['id'] as string;
    tx.intents.push({ type: 'card', cardId });
    const created = { card: await shaped(tx, cardId), ...(await counts(tx, [listId])) };
    if (usable !== null) {
      await tx.client.query('INSERT INTO idempotency_keys (user_id, key, list_id, title, response) VALUES ($1,$2,$3,$4,$5::jsonb)', [
        actor.userId, usable, listId, title, JSON.stringify(created),
      ]);
    }
    return { body: created, replay: false };
  });
  return { status: 201, body: outcome.body, ...(outcome.replay ? { headers: REPLAY } : {}) };
};

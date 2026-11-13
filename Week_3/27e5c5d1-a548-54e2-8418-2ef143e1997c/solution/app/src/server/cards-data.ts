import type { Attachment, Card, CardStatus, ChecklistItem, Colour, DueState, Label, ListCount, Owner, Person, Role } from '../shared/types.ts';
import { LABELS, isWriter } from '../shared/types.ts';
import type { Db, Row } from './db.ts';

export interface CardRec {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  notes: string;
  dueDate: string | null;
  labels: Label[];
  owner: (Person & { userId: string }) | null;
  status: CardStatus;
  version: number;
  rank: number | null;
  lastChangeBy: string;
  lastChange: 'moved' | 'edited';
  checklist: ChecklistItem[];
  attachments: Attachment[];
  privateMembers: { userId: string; displayName: string }[];
}

interface ListRec {
  id: string;
  name: string;
  position: number;
}

export interface Snapshot {
  lists: ListRec[];
  /** Non-archived cards, ordered by list then rank. */
  cards: CardRec[];
}

export interface Viewer {
  userId: string;
  role: Role;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export { byName };

/** The people a card is private to, as a SQL column for statements that read cards without loading them whole. */
export const PRIVATE_USERS_SQL = 'ARRAY(SELECT p.user_id FROM card_private_members p WHERE p.card_id = c.id) AS named';
export const privateUsersOf = (row: Row): { userId: string }[] => (row['named'] as string[]).map((userId) => ({ userId }));

/** Who may see a card: a shared card is visible to every role; a private card only to its named members and admins. */
export function canSee(card: { privateMembers: { userId: string }[] }, viewer: Viewer): boolean {
  if (card.privateMembers.length === 0) return true;
  return isWriter(viewer.role) && card.privateMembers.some((member) => member.userId === viewer.userId);
}

const CARD_COLUMNS = `c.id, c.board_id, c.list_id, c.title, c.notes, c.due_date, c.labels, c.status, c.version, c.rank,
  c.last_change, c.owner_user_id, o.display_name AS owner_name, o.initials AS owner_initials, o.colour AS owner_colour,
  lc.display_name AS last_change_name`;

async function hydrate(db: Db, rows: Row[]): Promise<CardRec[]> {
  const ids = rows.map((row) => row['id'] as string);
  const checklist = new Map<string, ChecklistItem[]>();
  const attachments = new Map<string, Attachment[]>();
  const privates = new Map<string, { userId: string; displayName: string }[]>();
  if (ids.length > 0) {
    const items = await db.query<Row>('SELECT id, card_id, text, done FROM checklist_items WHERE card_id = ANY($1) ORDER BY seq', [ids]);
    for (const row of items.rows) {
      const list = checklist.get(row['card_id'] as string) ?? [];
      list.push({ id: row['id'] as string, text: row['text'] as string, done: row['done'] as boolean });
      checklist.set(row['card_id'] as string, list);
    }
    const files = await db.query<Row>(
      `SELECT a.id, a.card_id, a.filename, a.content_type, a.size, a.uploaded_at, u.display_name
         FROM attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.card_id = ANY($1) ORDER BY a.uploaded_at, a.id`,
      [ids],
    );
    for (const row of files.rows) {
      const list = attachments.get(row['card_id'] as string) ?? [];
      list.push({
        id: row['id'] as string,
        filename: row['filename'] as string,
        contentType: row['content_type'] as string,
        size: row['size'] as number,
        uploadedAt: (row['uploaded_at'] as Date).toISOString(),
        uploadedBy: { displayName: row['display_name'] as string },
      });
      attachments.set(row['card_id'] as string, list);
    }
    const members = await db.query<Row>(
      'SELECT p.card_id, p.user_id, u.display_name FROM card_private_members p JOIN users u ON u.id = p.user_id WHERE p.card_id = ANY($1)',
      [ids],
    );
    for (const row of members.rows) {
      const list = privates.get(row['card_id'] as string) ?? [];
      list.push({ userId: row['user_id'] as string, displayName: row['display_name'] as string });
      privates.set(row['card_id'] as string, list);
    }
  }
  return rows.map((row) => {
    const id = row['id'] as string;
    return {
      id,
      boardId: row['board_id'] as string,
      listId: row['list_id'] as string,
      title: row['title'] as string,
      notes: row['notes'] as string,
      dueDate: (row['due_date'] as string | null) ?? null,
      labels: LABELS.filter((label) => (row['labels'] as string[]).includes(label)),
      owner: row['owner_user_id']
        ? {
            userId: row['owner_user_id'] as string,
            displayName: row['owner_name'] as string,
            initials: row['owner_initials'] as string,
            colour: row['owner_colour'] as Colour,
          }
        : null,
      status: row['status'] as CardStatus,
      version: row['version'] as number,
      rank: (row['rank'] as number | null) ?? null,
      lastChangeBy: (row['last_change_name'] as string | null) ?? '',
      lastChange: row['last_change'] as 'moved' | 'edited',
      checklist: checklist.get(id) ?? [],
      attachments: attachments.get(id) ?? [],
      privateMembers: (privates.get(id) ?? []).sort((a, b) => byName(a.displayName, b.displayName)),
    };
  });
}

const FROM_CARDS = `FROM cards c LEFT JOIN users o ON o.id = c.owner_user_id LEFT JOIN users lc ON lc.id = c.last_change_by`;

export async function loadSnapshot(db: Db, boardId: string): Promise<Snapshot> {
  const lists = await db.query<Row>('SELECT id, name, position FROM lists WHERE board_id = $1 ORDER BY position', [boardId]);
  const cards = await db.query<Row>(
    `SELECT ${CARD_COLUMNS} ${FROM_CARDS} WHERE c.board_id = $1 AND c.status <> 'archived' ORDER BY c.list_id, c.rank`,
    [boardId],
  );
  return {
    lists: lists.rows.map((row) => ({ id: row['id'] as string, name: row['name'] as string, position: row['position'] as number })),
    cards: await hydrate(db, cards.rows),
  };
}

export async function loadCard(db: Db, cardId: string): Promise<CardRec | null> {
  const { rows } = await db.query<Row>(`SELECT ${CARD_COLUMNS} ${FROM_CARDS} WHERE c.id = $1`, [cardId]);
  return (await hydrate(db, rows))[0] ?? null;
}

/** A card the caller has just written, so it exists. */
export async function loadWritten(db: Db, cardId: string): Promise<CardRec> {
  return (await loadCard(db, cardId)) as CardRec;
}

export async function loadArchived(db: Db, boardId: string): Promise<CardRec[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${CARD_COLUMNS} ${FROM_CARDS} WHERE c.board_id = $1 AND c.status = 'archived' ORDER BY c.archived_at DESC, c.id`,
    [boardId],
  );
  return hydrate(db, rows);
}

/** The cards of one list that the viewer can see, in rank order. */
function visibleIn(snapshot: Snapshot, listId: string, viewer: Viewer): CardRec[] {
  return snapshot.cards.filter((card) => card.listId === listId && canSee(card, viewer));
}

export function positionOf(snapshot: Snapshot, card: CardRec, viewer: Viewer): number | null {
  if (card.status === 'archived') return null;
  const index = visibleIn(snapshot, card.listId, viewer).findIndex((candidate) => candidate.id === card.id);
  return index < 0 ? null : index + 1;
}

export function countsFor(snapshot: Snapshot, listIds: string[], viewer: Viewer): ListCount[] {
  return [...new Set(listIds)].map((listId) => ({ listId, count: visibleIn(snapshot, listId, viewer).length }));
}

/** The open-card count of a board for one viewer. */
export function openCardCount(cards: { status: CardStatus; privateMembers: { userId: string }[] }[], viewer: Viewer): number {
  return cards.filter((card) => card.status === 'open' && canSee(card, viewer)).length;
}

/** The server decides the due state from the workspace's calendar day (DP-22, DP-60). */
function dueStateOf(dueDate: string | null, status: CardStatus, today: string): DueState {
  if (!dueDate || status !== 'open') return null;
  return dueDate === today ? 'due_today' : dueDate < today ? 'overdue' : 'upcoming';
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Response shaping per role: the one place that decides which keys a viewer gets. */
export function shapeCard(card: CardRec, viewer: Viewer, position: number | null, today: string): Card {
  const writer = isWriter(viewer.role);
  const owner: Owner | null = card.owner
    ? {
        ...(writer ? { userId: card.owner.userId } : {}),
        displayName: card.owner.displayName,
        initials: card.owner.initials,
        colour: card.owner.colour,
      }
    : null;
  const shared: Card = {
    id: card.id,
    boardId: card.boardId,
    listId: card.listId,
    title: card.title,
    position,
    labels: card.labels,
    dueDate: card.dueDate,
    dueState: dueStateOf(card.dueDate, card.status, today),
    status: card.status,
    version: card.version,
    owner,
    checklist: card.checklist,
  };
  if (!writer) return shared;
  return {
    ...shared,
    notes: card.notes,
    isPrivate: card.privateMembers.length > 0,
    privateMembers: card.privateMembers,
    attachments: card.attachments,
  };
}

export function shapeAll(snapshot: Snapshot, viewer: Viewer, today: string): { id: string; name: string; count: number; cards: Card[] }[] {
  return snapshot.lists.map((list) => {
    const cards = visibleIn(snapshot, list.id, viewer).map((card, index) => shapeCard(card, viewer, index + 1, today));
    return { id: list.id, name: list.name, count: cards.length, cards };
  });
}

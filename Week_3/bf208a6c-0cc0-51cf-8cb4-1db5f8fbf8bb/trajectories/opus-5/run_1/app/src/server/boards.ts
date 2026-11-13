import { randomBytes, randomUUID } from 'node:crypto';
import type { BoardDto, GroupMode, Layout, LinkAccess, Privacy, Role, SectionDto, SortMode } from '../shared/types';
import type { Db } from './db';
import { notFound, passwordRequired } from './errors';
import type { Unlocks } from './session';

export interface BoardRow {
  id: string;
  owner_id: string;
  title: string;
  layout: Layout;
  sort: SortMode;
  grouping: GroupMode;
  privacy: Privacy;
  password_hash: string | null;
  approval: boolean;
  link_access: LinkAccess;
  link_token: string | null;
  unlock_generation: number;
}

export interface Caller {
  userId: string | null;
  unlocks: Unlocks;
}

export interface BoardAccess {
  board: BoardRow;
  role: Role | null;
}

const BOARD_COLUMNS = `id, owner_id, title, layout, sort, grouping, privacy, password_hash, approval,
  link_access, link_token, unlock_generation`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loadBoardRow = async (db: Db, boardId: string): Promise<BoardRow | null> => {
  if (!UUID_PATTERN.test(boardId)) return null;
  const result = await db.query<BoardRow>(`select ${BOARD_COLUMNS} from boards where id = $1`, [boardId]);
  return result.rows[0] ?? null;
};

export const loadBoardByToken = async (db: Db, token: string): Promise<BoardRow | null> => {
  const result = await db.query<BoardRow>(`select ${BOARD_COLUMNS} from boards where link_token = $1`, [token]);
  return result.rows[0] ?? null;
};

export const roleOf = async (db: Db, board: BoardRow, userId: string | null): Promise<Role | null> => {
  if (userId === null) return null;
  if (board.owner_id === userId) return 'owner';
  const result = await db.query<{ role: Role }>('select role from memberships where board_id = $1 and user_id = $2', [
    board.id,
    userId,
  ]);
  return result.rows[0]?.role ?? null;
};

export const isUnlocked = (board: BoardRow, caller: Caller): boolean =>
  caller.unlocks[board.id] === board.unlock_generation;

/** Error order rules 2 and 3 for a board reached by its id. */
export const boardAccess = async (db: Db, caller: Caller, boardId: string): Promise<BoardAccess> => {
  const board = await loadBoardRow(db, boardId);
  if (board === null) throw notFound();
  const role = await roleOf(db, board, caller.userId);
  if (role !== null) return { board, role };
  if (board.privacy === 'private') throw notFound();
  if (board.privacy === 'password' && !isUnlocked(board, caller)) throw passwordRequired();
  return { board, role: null };
};

/** Error order rules 2 and 3 for a board reached by its share or embed token. */
export const linkAccess = async (
  db: Db,
  caller: Caller,
  token: string,
  mode: 'share' | 'embed',
): Promise<BoardAccess> => {
  const board = await loadBoardByToken(db, token);
  if (board === null || board.link_access === 'off') throw notFound();
  if (mode === 'embed' ? board.privacy !== 'public' : board.privacy === 'private') throw notFound();
  const role = await roleOf(db, board, caller.userId);
  if (role !== null) return { board, role };
  if (board.privacy === 'password' && !isUnlocked(board, caller)) throw passwordRequired();
  return { board, role: null };
};

export const loadSections = async (db: Db, boardId: string): Promise<SectionDto[]> => {
  const result = await db.query<{ id: string; title: string; count: number }>(
    `select s.id, s.title,
       (select count(*) from posts p where p.section_id = s.id and p.state = 'published')::int as count
     from sections s where s.board_id = $1 order by s.ord`,
    [boardId],
  );
  return result.rows;
};

export const boardDto = async (db: Db, board: BoardRow, role: Role | null): Promise<BoardDto> => {
  const sections = await loadSections(db, board.id);
  const isOwner = role === 'owner';
  const shareLive = board.link_access !== 'off' && board.privacy !== 'private' && board.link_token !== null;
  const embedLive = board.link_access !== 'off' && board.privacy === 'public' && board.link_token !== null;
  return {
    id: board.id,
    title: board.title,
    layout: board.layout,
    sort: board.sort,
    group: board.grouping,
    privacy: board.privacy,
    approval: board.approval,
    link_access: board.link_access,
    role,
    sections,
    share_path: isOwner && shareLive ? `/s/${board.link_token}` : null,
    embed_path: isOwner && embedLive ? `/embed/${board.link_token}` : null,
  };
};

export const newLinkToken = (): string => randomBytes(16).toString('base64url');

export const createBoard = async (
  db: Db,
  ownerId: string,
  title: string,
  sectionTitles: string[],
): Promise<BoardRow> => {
  const boardId = randomUUID();
  const result = await db.query<BoardRow>(
    `insert into boards (id, owner_id, title) values ($1, $2, $3) returning ${BOARD_COLUMNS}`,
    [boardId, ownerId, title],
  );
  for (const [index, sectionTitle] of sectionTitles.entries()) {
    await db.query('insert into sections (id, board_id, title, ord) values ($1, $2, $3, $4)', [
      randomUUID(),
      boardId,
      sectionTitle,
      index,
    ]);
  }
  return result.rows[0];
};

export const lockBoard = async (db: Db, boardId: string): Promise<void> => {
  await db.query('select id from boards where id = $1 for update', [boardId]);
};

import type { Tx } from './pool';
import { query, queryOne } from './pool';
import type {
  AttachmentPayload,
  CardStatus,
  ChecklistItem,
  Label,
  MoverColour,
  Visibility,
  WorkspaceRole,
} from '../../shared/types';

export interface Reader {
  query: Tx['query'];
  queryOne: Tx['queryOne'];
}

export const db: Reader = { query, queryOne };

export interface UserRow {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  phone: string;
  colour: MoverColour;
  initials: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  parent_name: string;
  time_zone: string;
}

export interface BoardRow {
  id: string;
  workspace_id: string;
  name: string;
  visibility: Visibility;
}

export interface ListRow {
  id: string;
  board_id: string;
  name: string;
  position: number;
}

export interface CardRecord {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  notes: string;
  dueDate: string | null;
  labels: Label[];
  status: CardStatus;
  version: number;
  rank: number | null;
  owner: { userId: string; displayName: string; initials: string; colour: MoverColour } | null;
  privateMembers: { userId: string; displayName: string }[];
  checklist: ChecklistItem[];
  attachments: AttachmentPayload[];
  lastChange: 'moved' | 'edited';
  lastChangedBy: string | null;
}

interface CardSqlRow {
  id: string;
  board_id: string;
  list_id: string;
  title: string;
  notes: string;
  due_date: string | null;
  labels: string[];
  status: CardStatus;
  version: number;
  position: number | null;
  last_change: 'moved' | 'edited';
  last_changed_by_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_initials: string | null;
  owner_colour: MoverColour | null;
  private_member_ids: string[] | null;
  private_member_names: string[] | null;
  checklist: ChecklistItem[] | null;
  attachments: AttachmentPayload[] | null;
}

const CARD_SELECT = `
select c.id, c.board_id, c.list_id, c.title, c.notes, c.due_date::text as due_date, c.labels,
       c.status, c.version, c.position, c.last_change,
       lc.display_name as last_changed_by_name,
       c.owner_user_id, o.display_name as owner_name, o.initials as owner_initials, o.colour as owner_colour,
       pm.ids as private_member_ids, pm.names as private_member_names,
       ci.items as checklist, att.items as attachments
  from cards c
  left join users o on o.id = c.owner_user_id
  left join users lc on lc.id = c.last_changed_by
  left join lateral (
    select array_agg(u.id order by u.display_name, u.id) as ids,
           array_agg(u.display_name order by u.display_name, u.id) as names
      from card_private_members p join users u on u.id = p.user_id
     where p.card_id = c.id
  ) pm on true
  left join lateral (
    select json_agg(json_build_object('id', i.id, 'text', i.text, 'done', i.done) order by i.position) as items
      from checklist_items i where i.card_id = c.id
  ) ci on true
  left join lateral (
    select json_agg(json_build_object(
             'id', a.id, 'filename', a.filename, 'contentType', a.content_type,
             'size', a.size,
             'uploadedAt', to_char(a.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'uploadedBy', json_build_object('displayName', au.display_name)
           ) order by a.uploaded_at, a.id) as items
      from attachments a join users au on au.id = a.uploaded_by_user_id
     where a.card_id = c.id
  ) att on true
`;

function toCardRecord(row: CardSqlRow): CardRecord {
  const ids = row.private_member_ids ?? [];
  const names = row.private_member_names ?? [];
  return {
    id: row.id,
    boardId: row.board_id,
    listId: row.list_id,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date,
    labels: row.labels as Label[],
    status: row.status,
    version: row.version,
    rank: row.position,
    owner:
      row.owner_user_id === null
        ? null
        : {
            userId: row.owner_user_id,
            displayName: String(row.owner_name),
            initials: String(row.owner_initials),
            colour: row.owner_colour as MoverColour,
          },
    privateMembers: ids.map((id, index) => ({ userId: id, displayName: String(names[index]) })),
    checklist: row.checklist ?? [],
    attachments: row.attachments ?? [],
    lastChange: row.last_change,
    lastChangedBy: row.last_changed_by_name,
  };
}

export async function loadUserByEmail(reader: Reader, email: string): Promise<UserRow | null> {
  return reader.queryOne<UserRow>(`select * from users where lower(email) = lower($1)`, [email]);
}

export async function loadWorkspace(reader: Reader, workspaceId: string): Promise<WorkspaceRow | null> {
  return reader.queryOne<WorkspaceRow>(
    `select id, name, parent_name, time_zone from workspaces where id = $1`,
    [workspaceId],
  );
}

export async function workspaceRoleOf(
  reader: Reader,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const row = await reader.queryOne<{ role: WorkspaceRole }>(
    `select role from workspace_members where workspace_id = $1 and user_id = $2`,
    [workspaceId, userId],
  );
  return row === null ? null : row.role;
}

export async function loadBoard(reader: Reader, boardId: string): Promise<BoardRow | null> {
  return reader.queryOne<BoardRow>(`select id, workspace_id, name, visibility from boards where id = $1`, [boardId]);
}

export async function loadLists(reader: Reader, boardId: string): Promise<ListRow[]> {
  return reader.query<ListRow>(
    `select id, board_id, name, position from lists where board_id = $1 order by position, id`,
    [boardId],
  );
}

export async function loadList(reader: Reader, listId: string): Promise<ListRow | null> {
  return reader.queryOne<ListRow>(`select id, board_id, name, position from lists where id = $1`, [listId]);
}

export async function loadBoardCards(reader: Reader, boardId: string): Promise<CardRecord[]> {
  const rows = await reader.query<CardSqlRow>(`${CARD_SELECT} where c.board_id = $1 order by c.position, c.created_at, c.id`, [
    boardId,
  ]);
  return rows.map(toCardRecord);
}

export async function loadCard(reader: Reader, cardId: string): Promise<CardRecord | null> {
  const rows = await reader.query<CardSqlRow>(`${CARD_SELECT} where c.id = $1`, [cardId]);
  const row = rows[0];
  return row === undefined ? null : toCardRecord(row);
}

export async function boardMemberState(
  reader: Reader,
  boardId: string,
  userId: string,
): Promise<'observer' | 'member' | 'admin' | 'removed' | 'none'> {
  const row = await reader.queryOne<{ state: 'observer' | 'member' | 'admin' | 'removed' }>(
    `select state from board_members where board_id = $1 and user_id = $2`,
    [boardId, userId],
  );
  return row === null ? 'none' : row.state;
}

export interface BoardMemberRow {
  user_id: string;
  state: 'observer' | 'member' | 'admin';
  display_name: string;
  initials: string;
  colour: MoverColour;
  email: string;
  phone: string;
}

export async function loadBoardMembers(reader: Reader, boardId: string): Promise<BoardMemberRow[]> {
  return reader.query<BoardMemberRow>(
    `select m.user_id, m.state, u.display_name, u.initials, u.colour, u.email, u.phone
       from board_members m join users u on u.id = m.user_id
      where m.board_id = $1 and m.state in ('observer','member','admin')
      order by u.display_name, u.id`,
    [boardId],
  );
}

export interface WorkspaceMemberRow {
  user_id: string;
  role: WorkspaceRole;
  display_name: string;
  initials: string;
  colour: MoverColour;
  email: string;
  phone: string;
  joined_seq: string;
}

export async function loadWorkspaceMembers(reader: Reader, workspaceId: string): Promise<WorkspaceMemberRow[]> {
  return reader.query<WorkspaceMemberRow>(
    `select m.user_id, m.role, m.joined_seq::text as joined_seq, u.display_name, u.initials, u.colour, u.email, u.phone
       from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = $1
      order by u.display_name, u.id`,
    [workspaceId],
  );
}

export async function loadLastColour(reader: Reader, workspaceId: string): Promise<MoverColour | null> {
  const row = await reader.queryOne<{ colour: MoverColour }>(
    `select u.colour from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = $1 order by m.joined_seq desc limit 1`,
    [workspaceId],
  );
  return row === null ? null : row.colour;
}

export async function loadWorkspaceBoards(reader: Reader, workspaceId: string): Promise<BoardRow[]> {
  return reader.query<BoardRow>(
    `select id, workspace_id, name, visibility from boards where workspace_id = $1 order by name, id`,
    [workspaceId],
  );
}

export async function lockBoard(tx: Tx, boardId: string): Promise<void> {
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [boardId]);
}

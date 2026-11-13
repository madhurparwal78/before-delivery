import { Pool, PoolClient } from 'pg';
import {
  COLOUR_ORDER,
  effectiveRole,
  initialsFor,
  shapeCard,
  type RawCardRow,
  type ShapeContext,
} from './rules.js';
import type {
  BoardMemberView,
  BoardPayload,
  BoardSummary,
  Card,
  CardList,
  Colour,
  Label,
  Role,
  WorkspacePersonView,
  WorkspaceRole,
} from '../shared/protocol.js';

export interface SessionRow {
  userId: string;
  displayName: string;
  email: string;
  initials: string;
  colour: Colour;
}

export interface WorkspaceRow {
  workspaceId: string;
  name: string;
  parentName: string;
  timeZone: string;
  role: WorkspaceRole;
}

export interface BoardRow {
  boardId: string;
  workspaceId: string;
  name: string;
  visibility: 'workspace' | 'private';
}

export interface BoardAccess {
  board: BoardRow;
  role: Role;
}

const LABEL_ORDER: Label[] = ['Medication', 'Appointment', 'Bills', 'Visit', 'Paperwork'];

export class Store {
  readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already lost; nothing to undo
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private static sqlIn(ids: string[]): string {
    return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  }

  async sessionByToken(tokenHash: string): Promise<SessionRow | null> {
    const result = await this.pool.query(
      `SELECT u.user_id AS "userId", u.display_name AS "displayName", u.email, u.initials, u.colour
       FROM kinfold_sessions s JOIN kinfold_users u ON u.user_id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash],
    );
    return (result.rows[0] as SessionRow | undefined) ?? null;
  }

  async userByEmail(email: string): Promise<{ userId: string; passwordHash: string } | null> {
    const result = await this.pool.query(
      `SELECT user_id AS "userId", password_hash AS "passwordHash" FROM kinfold_users WHERE email_lower = $1`,
      [email.trim().toLowerCase()],
    );
    return (result.rows[0] as { userId: string; passwordHash: string } | undefined) ?? null;
  }

  async userById(userId: string): Promise<{
    userId: string;
    displayName: string;
    email: string;
    phone: string | null;
    initials: string;
    colour: Colour;
  } | null> {
    const result = await this.pool.query(
      `SELECT user_id AS "userId", display_name AS "displayName", email, phone, initials, colour
       FROM kinfold_users WHERE user_id = $1`,
      [userId],
    );
    return (result.rows[0] as
      | { userId: string; displayName: string; email: string; phone: string | null; initials: string; colour: Colour }
      | undefined) ?? null;
  }

  async insertSession(tokenHash: string, userId: string): Promise<void> {
    await this.pool.query(`INSERT INTO kinfold_sessions (token_hash, user_id) VALUES ($1,$2)`, [tokenHash, userId]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM kinfold_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteOtherSessions(userId: string, keepTokenHash: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM kinfold_sessions WHERE user_id = $1 AND token_hash <> $2`,
      [userId, keepTokenHash],
    );
    return result.rowCount ?? 0;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceRow[]> {
    const result = await this.pool.query(
      `SELECT w.workspace_id AS "workspaceId", w.name, w.parent_name AS "parentName", w.time_zone AS "timeZone", m.role
       FROM kinfold_workspace_members m
       JOIN kinfold_workspaces w ON w.workspace_id = m.workspace_id
       WHERE m.user_id = $1
       ORDER BY w.created_at, w.workspace_id`,
      [userId],
    );
    return result.rows as WorkspaceRow[];
  }

  async workspaceById(userId: string, workspaceId: string): Promise<WorkspaceRow | null> {
    const result = await this.pool.query(
      `SELECT w.workspace_id AS "workspaceId", w.name, w.parent_name AS "parentName", w.time_zone AS "timeZone", m.role
       FROM kinfold_workspace_members m
       JOIN kinfold_workspaces w ON w.workspace_id = m.workspace_id
       WHERE m.user_id = $1 AND m.workspace_id = $2`,
      [userId, workspaceId],
    );
    return (result.rows[0] as WorkspaceRow | undefined) ?? null;
  }

  async workspaceOnly(workspaceId: string): Promise<{ workspaceId: string; name: string; parentName: string; timeZone: string } | null> {
    const result = await this.pool.query(
      `SELECT workspace_id AS "workspaceId", name, parent_name AS "parentName", time_zone AS "timeZone"
       FROM kinfold_workspaces WHERE workspace_id = $1`,
      [workspaceId],
    );
    return (result.rows[0] as { workspaceId: string; name: string; parentName: string; timeZone: string } | undefined) ?? null;
  }

  async workspaceMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const result = await this.pool.query(
      `SELECT role FROM kinfold_workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    return (result.rows[0] as { role: WorkspaceRole } | undefined)?.role ?? null;
  }

  async boardById(boardId: string): Promise<BoardRow | null> {
    const result = await this.pool.query(
      `SELECT board_id AS "boardId", workspace_id AS "workspaceId", name, visibility FROM kinfold_boards WHERE board_id = $1`,
      [boardId],
    );
    return (result.rows[0] as BoardRow | undefined) ?? null;
  }

  async boardMembership(boardId: string, userId: string): Promise<{ role: Role } | null> {
    const result = await this.pool.query(
      `SELECT role FROM kinfold_board_members WHERE board_id = $1 AND user_id = $2`,
      [boardId, userId],
    );
    return (result.rows[0] as { role: Role } | undefined) ?? null;
  }

  /** Effective board access: the single decision for who may see a board and at which role. */
  async boardAccess(boardId: string, userId: string, client?: PoolClient): Promise<BoardAccess | null> {
    const exec = client ?? this.pool;
    const boardRow = await exec.query(
      `SELECT b.board_id AS "boardId", b.workspace_id AS "workspaceId", b.name, b.visibility, m.role AS "wsRole"
       FROM kinfold_boards b
       LEFT JOIN kinfold_workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $2
       WHERE b.board_id = $1`,
      [boardId, userId],
    );
    const row = boardRow.rows[0] as
      | { boardId: string; workspaceId: string; name: string; visibility: 'workspace' | 'private'; wsRole: WorkspaceRole | null }
      | undefined;
    if (!row || !row.wsRole) return null;
    const membership = await exec.query(
      `SELECT role FROM kinfold_board_members WHERE board_id = $1 AND user_id = $2`,
      [boardId, userId],
    );
    const role = effectiveRole((membership.rows[0] as { role: Role } | undefined) ?? null, row.visibility);
    if (!role) return null;
    return {
      board: { boardId: row.boardId, workspaceId: row.workspaceId, name: row.name, visibility: row.visibility },
      role,
    };
  }

  async todayInTimeZone(timeZone: string): Promise<string> {
    const result = await this.pool.query(`SELECT (now() AT TIME ZONE $1)::date::text AS today`, [timeZone]);
    return (result.rows[0] as { today: string }).today;
  }

  async privateCardsForUser(userId: string, cardIds: string[]): Promise<Set<string>> {
    if (cardIds.length === 0) return new Set();
    const result = await this.pool.query(
      `SELECT card_id FROM kinfold_card_private_members WHERE user_id = $1 AND card_id IN (${Store.sqlIn(cardIds)})`,
      [userId],
    );
    return new Set((result.rows as { card_id: string }[]).map((r) => r.card_id));
  }

  private async rawCards(cardIds: string[]): Promise<
    { card_id: string; board_id: string; list_id: string; title: string; notes: string; rank: number; labels: string[]; due_date: string | null; status: Card['status']; version: number; owner_user_id: string | null; owner_name: string | null; owner_initials: string | null; owner_colour: string | null }[]
  > {
    if (cardIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT c.card_id, c.board_id, c.list_id, c.title, c.notes, c.rank, c.labels,
              c.due_date::text AS due_date, c.status, c.version,
              c.owner_user_id, o.display_name AS owner_name, o.initials AS owner_initials, o.colour AS owner_colour
       FROM kinfold_cards c
       LEFT JOIN kinfold_users o ON o.user_id = c.owner_user_id
       WHERE c.card_id IN (${Store.sqlIn(cardIds)})`,
    );
    return result.rows as never;
  }

  /** Full card payloads shaped for the caller's role. Ids must already be visibility-checked. */
  async shapeCards(cardIds: string[], role: Role, today: string, positions: Map<string, number>): Promise<Map<string, Card>> {
    const raw = await this.rawCards(cardIds);
    const checklistMap = await this.loadChecklist(cardIds);
    const privateMap = role === 'observer' ? new Map<string, { userId: string; displayName: string }[]>() : await this.loadPrivateMembers(cardIds);
    const attachmentMap = role === 'observer' ? new Map<string, RawCardRow['attachments']>() : await this.loadAttachments(cardIds);
    const byId = new Map<string, Card>();
    const ctx: ShapeContext = { role, canSeePrivate: true, dueToday: today, positions };
    for (const row of raw) {
      const shaped = shapeCard(
        {
          id: row.card_id,
          boardId: row.board_id,
          listId: row.list_id,
          title: row.title,
          rank: row.rank,
          labels: LABEL_ORDER.filter((l) => row.labels.includes(l)),
          dueDate: row.due_date,
          status: row.status,
          version: row.version,
          owner:
            row.owner_user_id && row.owner_name
              ? {
                  userId: row.owner_user_id,
                  displayName: row.owner_name,
                  initials: row.owner_initials ?? initialsFor(row.owner_name),
                  colour: (row.owner_colour ?? 'sage') as Colour,
                }
              : null,
          checklist: checklistMap.get(row.card_id) ?? [],
          notes: row.notes,
          isPrivate: (privateMap.get(row.card_id)?.length ?? 0) > 0,
          privateMembers: privateMap.get(row.card_id) ?? [],
          attachments: attachmentMap.get(row.card_id) ?? [],
        },
        ctx,
      );
      byId.set(row.card_id, shaped);
    }
    return byId;
  }

  private async loadChecklist(cardIds: string[]): Promise<Map<string, { id: string; text: string; done: boolean }[]>> {
    if (cardIds.length === 0) return new Map();
    const result = await this.pool.query(
      `SELECT card_id, item_id AS id, text, done FROM kinfold_checklist_items
       WHERE card_id IN (${Store.sqlIn(cardIds)}) ORDER BY position`,
    );
    const map = new Map<string, { id: string; text: string; done: boolean }[]>();
    for (const row of result.rows as { card_id: string; id: string; text: string; done: boolean }[]) {
      const list = map.get(row.card_id) ?? [];
      list.push({ id: row.id, text: row.text, done: row.done });
      map.set(row.card_id, list);
    }
    return map;
  }

  private async loadPrivateMembers(cardIds: string[]): Promise<Map<string, { userId: string; displayName: string }[]>> {
    if (cardIds.length === 0) return new Map();
    const result = await this.pool.query(
      `SELECT pm.card_id, pm.user_id AS "userId", u.display_name AS "displayName"
       FROM kinfold_card_private_members pm
       JOIN kinfold_users u ON u.user_id = pm.user_id
       WHERE pm.card_id IN (${Store.sqlIn(cardIds)})`,
    );
    const map = new Map<string, { userId: string; displayName: string }[]>();
    for (const row of result.rows as { card_id: string; userId: string; displayName: string }[]) {
      const list = map.get(row.card_id) ?? [];
      list.push({ userId: row.userId, displayName: row.displayName });
      map.set(row.card_id, list);
    }
    return map;
  }

  private async loadAttachments(cardIds: string[]): Promise<Map<string, RawCardRow['attachments']>> {
    if (cardIds.length === 0) return new Map();
    const result = await this.pool.query(
      `SELECT a.card_id, a.attachment_id AS "id", a.filename, a.content_type AS "contentType", a.size,
              a.uploaded_at AS "uploadedAt", u.display_name AS "uploadedByName"
       FROM kinfold_attachments a JOIN kinfold_users u ON u.user_id = a.uploaded_by
       WHERE a.card_id IN (${Store.sqlIn(cardIds)})`,
    );
    const map = new Map<string, RawCardRow['attachments']>();
    for (const row of result.rows as { card_id: string; id: string; filename: string; contentType: string; size: number; uploadedAt: Date; uploadedByName: string }[]) {
      const list = map.get(row.card_id) ?? [];
      list.push({
        id: row.id,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        uploadedAt: row.uploadedAt.toISOString(),
        uploadedByName: row.uploadedByName,
      });
      map.set(row.card_id, list);
    }
    return map;
  }

  /** Visibility filter for a set of cards against a caller's board role. */
  async visibleCardIds(access: BoardAccess, userId: string, cardIds: string[]): Promise<Set<string>> {
    if (cardIds.length === 0) return new Set();
    const privateOnes = await this.pool.query(
      `SELECT c.card_id FROM kinfold_cards c
       WHERE c.card_id IN (${Store.sqlIn(cardIds)})
         AND EXISTS (SELECT 1 FROM kinfold_card_private_members pm WHERE pm.card_id = c.card_id)`,
    );
    const privateIds = (privateOnes.rows as { card_id: string }[]).map((r) => r.card_id);
    const privateSet = new Set(privateIds);
    if (access.role === 'observer') {
      return new Set(cardIds.filter((id) => !privateSet.has(id)));
    }
    const mine = await this.privateCardsForUser(userId, privateIds);
    return new Set(cardIds.filter((id) => !privateSet.has(id) || mine.has(id)));
  }

  /** Whether the caller can see one card right now. */
  async canSeeCard(access: BoardAccess, userId: string, cardId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (SELECT 1 FROM kinfold_card_private_members pm WHERE pm.card_id = c.card_id) AS is_private
       FROM kinfold_cards c WHERE c.card_id = $1`,
      [cardId],
    );
    const row = result.rows[0] as { is_private: boolean } | undefined;
    if (!row) return false;
    if (!row.is_private) return true;
    if (access.role === 'observer') return false;
    const mine = await this.privateCardsForUser(userId, [cardId]);
    return mine.has(cardId);
  }

  /** The full board payload: lists in order, cards by position, per-viewer positions and counts. */
  async boardPayload(access: BoardAccess, userId: string): Promise<BoardPayload> {
    const ws = await this.workspaceOnly(access.board.workspaceId);
    const today = await this.todayInTimeZone(ws?.timeZone ?? 'UTC');
    const listsResult = await this.pool.query(
      `SELECT list_id AS id, name, position FROM kinfold_lists WHERE board_id = $1 ORDER BY position`,
      [access.board.boardId],
    );
    const lists = listsResult.rows as { id: string; name: string; position: number }[];
    const cardsResult = await this.pool.query(
      `SELECT card_id AS id, list_id AS "listId", rank, status FROM kinfold_cards
       WHERE board_id = $1 ORDER BY rank`,
      [access.board.boardId],
    );
    const allCards = cardsResult.rows as { id: string; listId: string; rank: number; status: string }[];
    const nonArchived = allCards.filter((c) => c.status !== 'archived');
    const visible = await this.visibleCardIds(access, userId, nonArchived.map((c) => c.id));
    const visibleInOrder = nonArchived.filter((c) => visible.has(c.id));
    const perList = new Map<string, { id: string; listId: string; rank: number }[]>();
    for (const card of visibleInOrder) {
      const bucket = perList.get(card.listId) ?? [];
      bucket.push(card);
      perList.set(card.listId, bucket);
    }
    const positions = new Map<string, number>();
    const countsByList = new Map<string, number>();
    for (const list of lists) countsByList.set(list.id, 0);
    for (const [, bucket] of perList) {
      bucket.sort((a, b) => a.rank - b.rank);
      for (const [index, card] of bucket.entries()) {
        positions.set(card.id, index + 1);
        countsByList.set(card.listId, (countsByList.get(card.listId) ?? 0) + 1);
      }
    }
    const shaped = await this.shapeCards(visibleInOrder.map((c) => c.id), access.role, today, positions);
    const cardLists: CardList[] = lists.map((list) => {
      const bucket = (perList.get(list.id) ?? []).map((c) => shaped.get(c.id)).filter((c): c is Card => Boolean(c));
      bucket.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      return { id: list.id, name: list.name, count: countsByList.get(list.id) ?? 0, cards: bucket };
    });
    return {
      board: {
        id: access.board.boardId,
        name: access.board.name,
        visibility: access.board.visibility,
        workspaceId: access.board.workspaceId,
        parentName: ws?.parentName ?? '',
      },
      role: access.role,
      lists: cardLists,
    };
  }

  /** Per-viewer counts for the lists touched by a change. */
  async listCounts(access: BoardAccess, userId: string, listIds: string[]): Promise<{ listId: string; count: number }[]> {
    const unique = [...new Set(listIds)];
    const counts: { listId: string; count: number }[] = [];
    for (const listId of unique) {
      const result = await this.pool.query(
        `SELECT c.card_id, EXISTS (SELECT 1 FROM kinfold_card_private_members pm WHERE pm.card_id = c.card_id) AS is_private
         FROM kinfold_cards c
         WHERE c.list_id = $1 AND c.status <> 'archived'`,
        [listId],
      );
      const rows = result.rows as { card_id: string; is_private: boolean }[];
      if (access.role === 'observer') {
        counts.push({ listId, count: rows.filter((r) => !r.is_private).length });
      } else {
        const privateIds = rows.filter((r) => r.is_private).map((r) => r.card_id);
        const mine = await this.privateCardsForUser(userId, privateIds);
        counts.push({ listId, count: rows.filter((r) => !r.is_private || mine.has(r.card_id)).length });
      }
    }
    return counts;
  }

  /** The open-card count: the one place this number is computed. */
  async openCardCount(access: BoardAccess, userId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT c.card_id, EXISTS (SELECT 1 FROM kinfold_card_private_members pm WHERE pm.card_id = c.card_id) AS is_private
       FROM kinfold_cards c WHERE c.board_id = $1 AND c.status = 'open'`,
      [access.board.boardId],
    );
    const rows = result.rows as { card_id: string; is_private: boolean }[];
    if (access.role === 'observer') return rows.filter((r) => !r.is_private).length;
    const privateIds = rows.filter((r) => r.is_private).map((r) => r.card_id);
    const mine = await this.privateCardsForUser(userId, privateIds);
    return rows.filter((r) => !r.is_private || mine.has(r.card_id)).length;
  }

  async boardMembersView(boardId: string, callerRole: Role): Promise<BoardMemberView[]> {
    const result = await this.pool.query(
      `SELECT u.user_id, u.display_name AS "displayName", u.initials, u.colour, u.phone, u.email, m.role
       FROM kinfold_board_members m JOIN kinfold_users u ON u.user_id = m.user_id
       WHERE m.board_id = $1 AND m.role <> 'removed' ORDER BY u.display_name`,
      [boardId],
    );
    const rows = result.rows as { user_id: string; displayName: string; initials: string; colour: Colour; phone: string | null; email: string; role: Role }[];
    return rows.map((r) => {
      const view: BoardMemberView = { displayName: r.displayName, initials: r.initials, colour: r.colour };
      if (callerRole !== 'observer') {
        view.userId = r.user_id;
        view.role = r.role;
        view.phone = r.phone ?? undefined;
      }
      if (callerRole === 'admin') view.email = r.email;
      return view;
    });
  }

  async workspacePeopleView(workspaceId: string, callerIsAdmin: boolean): Promise<WorkspacePersonView[]> {
    const result = await this.pool.query(
      `SELECT u.user_id, u.display_name AS "displayName", u.initials, u.colour, u.phone, u.email, m.role
       FROM kinfold_workspace_members m JOIN kinfold_users u ON u.user_id = m.user_id
       WHERE m.workspace_id = $1 ORDER BY u.display_name`,
      [workspaceId],
    );
    const rows = result.rows as { user_id: string; displayName: string; initials: string; colour: Colour; phone: string | null; email: string; role: WorkspaceRole }[];
    return rows.map((r) => {
      const view: WorkspacePersonView = { displayName: r.displayName, initials: r.initials, colour: r.colour };
      if (callerIsAdmin) {
        view.userId = r.user_id;
        view.role = r.role;
        view.email = r.email;
        view.phone = r.phone ?? undefined;
      }
      return view;
    });
  }

  /** The next colour after the most recently added person in the workspace. */
  async nextColourForWorkspace(workspaceId: string): Promise<Colour> {
    const result = await this.pool.query(
      `SELECT u.colour FROM kinfold_workspace_members m
       JOIN kinfold_users u ON u.user_id = m.user_id
       WHERE m.workspace_id = $1 ORDER BY m.added_at DESC LIMIT 1`,
      [workspaceId],
    );
    const lastColour = (result.rows[0] as { colour: Colour } | undefined)?.colour;
    const index = lastColour ? COLOUR_ORDER.indexOf(lastColour) : -1;
    return COLOUR_ORDER[(index + 1) % COLOUR_ORDER.length] ?? 'sage';
  }

  async countBoardAdmins(boardId: string, client?: PoolClient): Promise<number> {
    const exec = client ?? this.pool;
    const result = await exec.query(
      `SELECT count(*)::int AS n FROM kinfold_board_members WHERE board_id = $1 AND role = 'admin'`,
      [boardId],
    );
    return (result.rows[0] as { n: number }).n;
  }

  async countWorkspaceAdmins(workspaceId: string, client?: PoolClient): Promise<number> {
    const exec = client ?? this.pool;
    const result = await exec.query(
      `SELECT count(*)::int AS n FROM kinfold_workspace_members WHERE workspace_id = $1 AND role = 'admin'`,
      [workspaceId],
    );
    return (result.rows[0] as { n: number }).n;
  }

  async insertPermissionLog(
    client: PoolClient,
    entry: {
      workspaceId: string;
      actorId: string;
      action: string;
      targetType: 'user' | 'board' | 'card';
      targetId: string;
      boardId: string | null;
      before: string | null;
      after: string | null;
    },
  ): Promise<void> {
    const entryId = `pl${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    await client.query(
      `INSERT INTO kinfold_permission_log (entry_id, workspace_id, actor_id, action, target_type, target_id, board_id, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [entryId, entry.workspaceId, entry.actorId, entry.action, entry.targetType, entry.targetId, entry.boardId, entry.before, entry.after],
    );
  }

  async cardById(cardId: string): Promise<{ id: string; boardId: string; listId: string; status: string; version: number; rank: number } | null> {
    const result = await this.pool.query(
      `SELECT card_id AS id, board_id AS "boardId", list_id AS "listId", status, version, rank
       FROM kinfold_cards WHERE card_id = $1`,
      [cardId],
    );
    return (result.rows[0] as { id: string; boardId: string; listId: string; status: string; version: number; rank: number } | undefined) ?? null;
  }

  async listById(listId: string): Promise<{ id: string; boardId: string; name: string; position: number } | null> {
    const result = await this.pool.query(
      `SELECT list_id AS id, board_id AS "boardId", name, position FROM kinfold_lists WHERE list_id = $1`,
      [listId],
    );
    return (result.rows[0] as { id: string; boardId: string; name: string; position: number } | undefined) ?? null;
  }

  /** Board summaries for a caller in a workspace, with open-card counts. */
  async boardSummaries(userId: string, workspaceId: string): Promise<BoardSummary[]> {
    const result = await this.pool.query(
      `SELECT b.board_id, b.name, b.visibility, m.role AS member_role
       FROM kinfold_boards b
       LEFT JOIN kinfold_board_members m ON m.board_id = b.board_id AND m.user_id = $2
       WHERE b.workspace_id = $1
       ORDER BY b.name`,
      [workspaceId, userId],
    );
    const rows = result.rows as { board_id: string; name: string; visibility: 'workspace' | 'private'; member_role: Role | null }[];
    const summaries: BoardSummary[] = [];
    for (const row of rows) {
      const role = effectiveRole(row.member_role ? { role: row.member_role } : null, row.visibility);
      if (!role) continue;
      const access: BoardAccess = {
        board: { boardId: row.board_id, workspaceId, name: row.name, visibility: row.visibility },
        role,
      };
      const open = await this.openCardCount(access, userId);
      summaries.push({ id: row.board_id, name: row.name, visibility: row.visibility, role, openCards: open });
    }
    return summaries;
  }
}

export { shapeCard };
export type { ShapeContext, RawCardRow };

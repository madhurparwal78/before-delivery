import { env } from '../env.js';
import { now } from '../clock.js';
import { query, tx, type Queryable } from '../db.js';
import { conflict, forbidden, gone, notFound, validation } from '../errors.js';
import { publish } from '../live.js';
import type { Operation, OperationKind, OperationStatus } from '../../shared/types.js';
import { boardHoldsRoot, insertPin } from './create.js';
import { recordBoardChange, setLastSaved, type Actor } from './changes.js';
import { makeRoom, renumber } from './pins.js';
import { canEditBoard, findBoard, boardVisible } from './visibility.js';

interface PriorPlacement {
  pin_id: number;
  board_id: number;
  section_id: number | null;
  position: number;
}

interface ContainerSnapshot {
  board_id: number;
  section_id: number | null;
  order: number[];
}

interface OperationPayload {
  pins: PriorPlacement[];
  created: number[];
  containers: ContainerSnapshot[];
  boards: { board_id: number; last_saved_at: string | null }[];
  first_pin: { id: number; title: string };
  source_boards: number[];
  target_board: number | null;
  target_section: number | null;
}

interface OperationRow {
  id: number;
  actor_id: number;
  kind: OperationKind;
  target_board_id: number | null;
  count: number;
  deadline: Date;
  status: OperationStatus;
  created_at: Date;
  payload: OperationPayload;
}

function effectiveStatus(row: OperationRow): OperationStatus {
  if (row.status === 'open' && now().getTime() >= row.deadline.getTime()) return 'expired';
  return row.status;
}

async function serialize(db: Queryable, row: OperationRow): Promise<Operation> {
  let board: { id: number; name: string } | null = null;
  if (row.target_board_id !== null) {
    const result = await db.query<{ id: number; name: string }>(
      'select id, name from boards where id = $1',
      [row.target_board_id],
    );
    board = result.rows[0] ?? null;
  }
  return {
    id: row.id,
    kind: row.kind,
    count: row.count,
    board,
    deadline: row.deadline.toISOString(),
    status: effectiveStatus(row),
  };
}

async function snapshotContainer(
  db: Queryable,
  boardId: number,
  sectionId: number | null,
): Promise<ContainerSnapshot> {
  const rows = await db.query<{ id: number }>(
    `select id from pins
      where board_id = $1 and section_id is not distinct from $2 and state = 'live'
      order by position, id`,
    [boardId, sectionId],
  );
  return { board_id: boardId, section_id: sectionId, order: rows.rows.map((row) => row.id) };
}

function containerKey(boardId: number, sectionId: number | null): string {
  return `${boardId}:${sectionId ?? 0}`;
}

/** Chosen pins run in their previous board order: unsectioned first, then sections in order. */
async function orderChosen(db: Queryable, pinIds: number[]): Promise<PriorPlacement[]> {
  const rows = await db.query<PriorPlacement & { section_position: number | null }>(
    `select p.id as pin_id, p.board_id, p.section_id, p.position,
            s.position as section_position
       from pins p
       left join sections s on s.id = p.section_id
      where p.id = any($1::bigint[])`,
    [pinIds],
  );
  return rows.rows
    .slice()
    .sort((left, right) => {
      if (left.board_id !== right.board_id) return left.board_id - right.board_id;
      const leftRank = left.section_id === null ? -1 : left.section_position ?? 0;
      const rightRank = right.section_id === null ? -1 : right.section_position ?? 0;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.position - right.position;
    })
    .map((row) => ({
      pin_id: row.pin_id,
      board_id: row.board_id,
      section_id: row.section_id,
      position: row.position,
    }));
}

export interface OperationRequest {
  kind: OperationKind;
  pinIds: number[];
  boardId: number | null;
  sectionId: number | null;
}

export async function createOperation(
  actor: Actor,
  request: OperationRequest,
): Promise<Operation> {
  if (request.pinIds.length === 0) throw validation('pins');
  if (new Set(request.pinIds).size !== request.pinIds.length) throw validation('pins');

  return tx(async (db) => {
    const pinRows = await db.query<{
      id: number;
      title: string;
      board_id: number;
      owner_id: number;
      root_pin_id: number | null;
    }>(
      `select p.id, p.title, p.board_id, p.owner_id, p.root_pin_id
         from pins p where p.id = any($1::bigint[]) and p.state = 'live'`,
      [request.pinIds],
    );
    if (pinRows.rows.length !== request.pinIds.length) throw notFound();
    const pins = new Map(pinRows.rows.map((row) => [row.id, row]));

    const sourceBoards = new Set<number>();
    for (const pinId of request.pinIds) {
      const pin = pins.get(pinId);
      if (!pin) throw notFound();
      const board = await findBoard(db, pin.board_id, actor.id);
      if (!board || !boardVisible(board, actor.id)) throw notFound();
      if (!canEditBoard(board, actor.id)) throw forbidden();
      sourceBoards.add(pin.board_id);
    }

    let targetBoardId: number | null = null;
    let targetSectionId: number | null = null;
    if (request.kind !== 'delete') {
      if (request.boardId === null) throw validation('board');
      const target = await findBoard(db, request.boardId, actor.id);
      if (!target || !boardVisible(target, actor.id)) throw notFound();
      if (!canEditBoard(target, actor.id)) throw forbidden();
      targetBoardId = target.id;
      if (request.sectionId !== null) {
        const section = await db.query<{ id: number }>(
          'select id from sections where id = $1 and board_id = $2 and deleted_at is null',
          [request.sectionId, target.id],
        );
        if (!section.rows[0]) throw notFound();
        targetSectionId = request.sectionId;
      }
      const roots = new Map<number, number>();
      for (const pinId of request.pinIds) {
        const pin = pins.get(pinId);
        if (!pin) throw notFound();
        const root = pin.root_pin_id ?? pin.id;
        if (roots.has(root)) {
          throw conflict('already_on_board', { board: { id: target.id, name: target.name } });
        }
        roots.set(root, pinId);
      }
      const exclude = request.kind === 'move' ? request.pinIds : [];
      for (const [root] of roots) {
        if (await boardHoldsRoot(db, target.id, root, exclude)) {
          throw conflict('already_on_board', { board: { id: target.id, name: target.name } });
        }
      }
    }

    const ordered = await orderChosen(db, request.pinIds);
    const containerKeys = new Map<string, ContainerSnapshot>();
    for (const placement of ordered) {
      const key = containerKey(placement.board_id, placement.section_id);
      if (!containerKeys.has(key)) {
        containerKeys.set(key, await snapshotContainer(db, placement.board_id, placement.section_id));
      }
    }
    if (targetBoardId !== null) {
      const key = containerKey(targetBoardId, targetSectionId);
      if (!containerKeys.has(key)) {
        containerKeys.set(key, await snapshotContainer(db, targetBoardId, targetSectionId));
      }
    }

    const touchedBoards = new Set<number>(sourceBoards);
    if (targetBoardId !== null) touchedBoards.add(targetBoardId);
    const boardRows = await db.query<{ id: number; last_saved_at: Date | null }>(
      'select id, last_saved_at from boards where id = any($1::bigint[])',
      [[...touchedBoards]],
    );

    const at = now();
    const payload: OperationPayload = {
      pins: ordered,
      created: [],
      containers: [...containerKeys.values()],
      boards: boardRows.rows.map((row) => ({
        board_id: row.id,
        last_saved_at: row.last_saved_at === null ? null : row.last_saved_at.toISOString(),
      })),
      first_pin: { id: ordered[0].pin_id, title: pins.get(ordered[0].pin_id)?.title ?? '' },
      source_boards: [...sourceBoards],
      target_board: targetBoardId,
      target_section: targetSectionId,
    };

    const inserted = await db.query<{ id: number }>(
      `insert into operations (actor_id, kind, target_board_id, count, deadline, status, created_at, payload)
       values ($1, $2, $3, $4, $5, 'open', $6, $7::jsonb) returning id`,
      [
        actor.id,
        request.kind,
        targetBoardId,
        request.pinIds.length,
        new Date(at.getTime() + env.undoSeconds * 1000).toISOString(),
        at.toISOString(),
        JSON.stringify(payload),
      ],
    );
    const operationId = inserted.rows[0].id;

    if (request.kind === 'move' && targetBoardId !== null) {
      await makeRoom(db, targetBoardId, targetSectionId, ordered.length);
      for (const [index, placement] of ordered.entries()) {
        await db.query(
          'update pins set board_id = $2, section_id = $3, position = $4 where id = $1',
          [placement.pin_id, targetBoardId, targetSectionId, index + 1],
        );
      }
    } else if (request.kind === 'copy' && targetBoardId !== null) {
      for (const placement of [...ordered].reverse()) {
        const source = await db.query<{
          title: string;
          description: string;
          alt: string;
          source: string | null;
          image_id: number;
          root_pin_id: number | null;
        }>(
          `select title, description, alt, source, image_id, root_pin_id from pins where id = $1`,
          [placement.pin_id],
        );
        const row = source.rows[0];
        const copyId = await insertPin(db, {
          ownerId: actor.id,
          boardId: targetBoardId,
          sectionId: targetSectionId,
          title: row.title,
          description: row.description,
          alt: row.alt,
          source: row.source,
          imageId: row.image_id,
          rootPinId: row.root_pin_id ?? placement.pin_id,
          at,
        });
        await db.query(`update pins set state = 'live' where id = $1`, [copyId]);
        payload.created.unshift(copyId);
      }
      await db.query('update operations set payload = $2::jsonb where id = $1', [
        operationId,
        JSON.stringify(payload),
      ]);
    } else {
      await db.query(
        `update pins set state = 'deleted', deleted_at = $2, delete_op_id = $3
          where id = any($1::bigint[])`,
        [request.pinIds, at.toISOString(), operationId],
      );
    }

    for (const container of payload.containers) {
      await renumber(db, container.board_id, container.section_id);
    }
    const putsPinsOnTarget =
      request.kind === 'copy' ||
      (request.kind === 'move' && [...sourceBoards].some((id) => id !== targetBoardId));
    if (putsPinsOnTarget && targetBoardId !== null) {
      await setLastSaved(db, targetBoardId, at);
    }

    for (const boardId of touchedBoards) {
      const change = boardChangeFor(request.kind, boardId, targetBoardId, [...sourceBoards]);
      await recordBoardChange(db, boardId, actor, change, payload.first_pin);
    }
    for (const pinId of request.pinIds) {
      const pin = pins.get(pinId);
      if (pin) await publish({ k: 'counts', pin_id: pin.root_pin_id ?? pin.id }, db);
    }
    for (const created of payload.created) {
      await publish({ k: 'feed', pin_id: created }, db);
    }

    const row = await db.query<OperationRow>('select * from operations where id = $1', [operationId]);
    return serialize(db, row.rows[0]);
  });
}

function boardChangeFor(
  kind: OperationKind,
  boardId: number,
  targetBoardId: number | null,
  sourceBoards: number[],
): 'added' | 'removed' | 'moved' {
  if (kind === 'delete') return 'removed';
  if (kind === 'copy') return 'added';
  if (boardId === targetBoardId) {
    return sourceBoards.includes(boardId) ? 'moved' : 'added';
  }
  return 'removed';
}

function reverseChange(change: 'added' | 'removed' | 'moved'): 'added' | 'removed' | 'moved' {
  if (change === 'added') return 'removed';
  if (change === 'removed') return 'added';
  return 'moved';
}

export async function undoOperation(actor: Actor, operationId: number): Promise<Operation> {
  return tx(async (db) => {
    const rows = await db.query<OperationRow>(
      'select * from operations where id = $1 for update',
      [operationId],
    );
    const row = rows.rows[0];
    if (!row || row.actor_id !== actor.id) throw notFound();
    const status = effectiveStatus(row);
    if (row.status === 'undone') throw conflict('already_undone');
    if (status === 'expired') throw gone('undo_expired');

    const payload = row.payload;
    const pinIds = payload.pins.map((placement) => placement.pin_id);
    const pinRows = await db.query<{ id: number; title: string; state: string }>(
      'select id, title, state from pins where id = any($1::bigint[])',
      [pinIds],
    );
    if (pinRows.rows.length !== pinIds.length) throw conflict('undo_conflict');
    if (pinRows.rows.some((pin) => pin.state === 'gone')) throw conflict('undo_conflict');

    const boardIds = [...new Set(payload.pins.map((placement) => placement.board_id))];
    const liveBoards = await db.query<{ id: number }>(
      'select id from boards where id = any($1::bigint[]) and deleted_at is null',
      [boardIds],
    );
    if (liveBoards.rows.length !== boardIds.length) throw conflict('undo_conflict');
    const sectionIds = [
      ...new Set(
        payload.pins
          .map((placement) => placement.section_id)
          .filter((value): value is number => value !== null),
      ),
    ];
    if (sectionIds.length > 0) {
      const liveSections = await db.query<{ id: number }>(
        'select id from sections where id = any($1::bigint[]) and deleted_at is null',
        [sectionIds],
      );
      if (liveSections.rows.length !== sectionIds.length) throw conflict('undo_conflict');
    }
    if (payload.target_board !== null) {
      const target = await db.query<{ id: number }>(
        'select id from boards where id = $1 and deleted_at is null',
        [payload.target_board],
      );
      if (!target.rows[0]) throw conflict('undo_conflict');
    }

    if (row.kind === 'copy') {
      const createdLive = await db.query<{ id: number }>(
        `select id from pins where id = any($1::bigint[]) and state <> 'live'`,
        [payload.created],
      );
      if (createdLive.rows.length > 0) throw conflict('undo_conflict');
      await db.query(
        `update pins set state = 'gone', deleted_at = $2 where id = any($1::bigint[])`,
        [payload.created, now().toISOString()],
      );
    } else if (row.kind === 'delete') {
      await db.query(
        `update pins set state = 'live', deleted_at = null, delete_op_id = null
          where id = any($1::bigint[])`,
        [pinIds],
      );
    }

    for (const placement of payload.pins) {
      await db.query('update pins set board_id = $2, section_id = $3 where id = $1', [
        placement.pin_id,
        placement.board_id,
        placement.section_id,
      ]);
    }

    for (const container of payload.containers) {
      const current = await db.query<{ id: number }>(
        `select id from pins
          where board_id = $1 and section_id is not distinct from $2 and state = 'live'
          order by position, id`,
        [container.board_id, container.section_id],
      );
      const currentIds = current.rows.map((pin) => pin.id);
      const snapshot = container.order.filter((id) => currentIds.includes(id));
      const extras = currentIds.filter((id) => !container.order.includes(id));
      const final = [...extras, ...snapshot];
      for (const [index, pinId] of final.entries()) {
        await db.query('update pins set position = $2 where id = $1', [pinId, index + 1]);
      }
    }
    const targetKey =
      payload.target_board === null
        ? null
        : containerKey(payload.target_board, payload.target_section);
    if (targetKey !== null && !payload.containers.some((c) => containerKey(c.board_id, c.section_id) === targetKey)) {
      await renumber(db, payload.target_board as number, payload.target_section);
    }

    for (const board of payload.boards) {
      await setLastSaved(db, board.board_id, board.last_saved_at === null ? null : new Date(board.last_saved_at));
    }

    await db.query(`update operations set status = 'undone' where id = $1`, [operationId]);

    const touched = new Set<number>(payload.source_boards);
    if (payload.target_board !== null) touched.add(payload.target_board);
    for (const boardId of touched) {
      const change = reverseChange(
        boardChangeFor(row.kind, boardId, payload.target_board, payload.source_boards),
      );
      await recordBoardChange(db, boardId, actor, change, payload.first_pin);
    }
    for (const placement of payload.pins) {
      await publish({ k: 'counts', pin_id: placement.pin_id }, db);
    }
    if (row.kind === 'delete') {
      for (const placement of payload.pins) {
        await publish({ k: 'feed', pin_id: placement.pin_id }, db);
      }
    }

    const updated = await db.query<OperationRow>('select * from operations where id = $1', [
      operationId,
    ]);
    return serialize(db, updated.rows[0]);
  });
}

export async function expireDueOperations(): Promise<void> {
  const due = await query<{ id: number; actor_id: number; kind: OperationKind; payload: OperationPayload }>(
    `update operations set status = 'expired'
      where status = 'open' and deadline <= $1
      returning id, actor_id, kind, payload`,
    [now().toISOString()],
  );
  for (const operation of due) {
    if (operation.kind === 'delete') {
      await query(
        `update pins set state = 'gone' where id = any($1::bigint[]) and state = 'deleted'`,
        [operation.payload.pins.map((placement) => placement.pin_id)],
      );
    }
    await publish({ k: 'operation_expired', id: operation.id, actor_id: operation.actor_id });
  }
}

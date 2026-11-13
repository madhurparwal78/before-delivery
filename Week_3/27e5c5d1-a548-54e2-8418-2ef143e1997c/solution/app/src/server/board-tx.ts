import type pg from 'pg';
import { WRITER_ROLES, type Role } from '../shared/types.ts';
import { boardAccess, type BoardAccess } from './access.ts';
import type { Actor } from './auth.ts';
import { loadSnapshot, todayIn, type Snapshot, type Viewer } from './cards-data.ts';
import { lockBoard, transaction, type Row } from './db.ts';
import { buildEnvelope, type Intent } from './events.ts';
import { notFound } from './errors.ts';
import { accessChanged, publishEnvelope } from './hub.ts';
import { isId } from './validate.ts';

export interface BoardTx {
  client: pg.PoolClient;
  actor: Actor;
  access: BoardAccess;
  viewer: Viewer;
  before: Snapshot;
  intents: Intent[];
  /** Whose open streams must be checked against the new access once this commits. */
  accessSignals: { boardId?: string; userId?: string }[];
  /** The board as this transaction has left it so far. */
  snapshot(): Promise<Snapshot>;
}

/**
 * A write to one board: serialised against every other write to it, run in one transaction, and followed by the
 * events its intents describe, shaped for every recipient. Nothing is sent when the transaction fails.
 */
export async function boardWrite<T>(actor: Actor, boardId: string, run: (tx: BoardTx) => Promise<T>): Promise<T> {
  if (!isId(boardId)) throw notFound();
  const outcome = await transaction(async (client) => {
    await lockBoard(client, boardId);
    const access = await boardAccess(client, actor.userId, boardId);
    if (!access) throw notFound();
    const before = await loadSnapshot(client, boardId);
    const tx: BoardTx = {
      client,
      actor,
      access,
      viewer: { userId: actor.userId, role: access.role },
      before,
      intents: [],
      accessSignals: [],
      snapshot: () => loadSnapshot(client, boardId),
    };
    const result = await run(tx);
    let envelope = null;
    if (tx.intents.length > 0) {
      const after = await loadSnapshot(client, boardId);
      const { rows } = await client.query<Row>(
        `SELECT user_id, role FROM board_members WHERE board_id = $1 AND role = ANY($2::text[])`,
        [boardId, WRITER_ROLES],
      );
      const writers = rows.map((row) => ({ userId: row['user_id'] as string, role: row['role'] as Role }));
      envelope = buildEnvelope(boardId, tx.intents, before, after, writers, todayIn(access.board.timeZone));
    }
    return { result, envelope, signals: tx.accessSignals };
  });
  if (outcome.envelope) void publishEnvelope(outcome.envelope);
  for (const signal of outcome.signals) void accessChanged(signal);
  return outcome.result;
}

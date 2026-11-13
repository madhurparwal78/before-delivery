import type { ServerResponse } from 'node:http';
import type { BoardRole } from '../../shared/types';
import { db } from '../db/repo';
import { loadSnapshot, roleOnBoard } from '../domain/boardService';
import type { Viewer } from '../domain/snapshot';
import { boardChannel, relay, userChannel } from '../services/relay';
import { newId } from '../lib/crypto';

export interface PreMoveCard {
  id: string;
  privateTo: string[];
}

export type BoardSignal =
  | { type: 'card.created'; cardId: string; listIds: string[] }
  | { type: 'card.updated'; cardId: string; listIds: string[] }
  | {
      type: 'card.moved';
      cardId: string;
      moverUserId: string;
      fromListId: string;
      toListId: string;
      fromOrder: PreMoveCard[];
    }
  | { type: 'card.removed'; cardId: string; listIds: string[] }
  | { type: 'list.created'; listId: string }
  | { type: 'list.updated'; listId: string }
  | { type: 'board.updated' }
  | { type: 'membership' };

export type UserSignal =
  | { type: 'access'; boardId: string }
  | { type: 'session'; keepTokenHash: string | null };

interface Envelope {
  origin: string;
  signal: BoardSignal | UserSignal;
}

const INSTANCE = newId();

class LiveStream {
  readonly boardId: string;
  readonly userId: string;
  readonly tokenHash: string;
  role: BoardRole;
  visible: Map<string, string>;
  private readonly response: ServerResponse;
  private closed = false;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    response: ServerResponse,
    boardId: string,
    userId: string,
    tokenHash: string,
    role: BoardRole,
    visible: Map<string, string>,
  ) {
    this.response = response;
    this.boardId = boardId;
    this.userId = userId;
    this.tokenHash = tokenHash;
    this.role = role;
    this.visible = visible;
    this.timers.push(setInterval(() => this.comment(), 10_000));
    this.timers.push(setInterval(() => void this.watch(), 1000));
  }

  write(type: string, data: unknown): void {
    if (this.closed) return;
    this.response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private comment(): void {
    if (this.closed) return;
    this.response.write(': keep-alive\n\n');
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    streams.delete(this);
    this.response.end();
  }

  /** Access and session changes reach a stream even when the relay is down. */
  private async watch(): Promise<void> {
    if (this.closed) return;
    const session = await db.queryOne<{ user_id: string }>(`select user_id from sessions where token_hash = $1`, [
      this.tokenHash,
    ]);
    if (session === null) {
      this.write('session.ended', {});
      this.end();
      return;
    }
    const snapshot = await loadSnapshot(db, this.boardId);
    const role = snapshot === null ? null : await roleOnBoard(db, snapshot.board, this.userId);
    if (role === null || role !== this.role) {
      this.write('access.changed', { role });
      this.end();
    }
  }
}

const streams = new Set<LiveStream>();

export async function openStream(
  response: ServerResponse,
  boardId: string,
  viewer: Viewer,
  tokenHash: string,
): Promise<void> {
  const snapshot = await loadSnapshot(db, boardId);
  const visible = snapshot === null ? new Map<string, string>() : snapshot.visibleCardIds(viewer);
  const stream = new LiveStream(response, boardId, viewer.userId, tokenHash, viewer.role, visible);
  streams.add(stream);
  response.on('close', () => stream.end());
  if (relay.status() === 'paused') stream.write('live.paused', {});
}

async function dispatchBoard(boardId: string, signal: BoardSignal): Promise<void> {
  const targets = [...streams].filter((stream) => stream.boardId === boardId);
  if (targets.length === 0) return;
  const snapshot = await loadSnapshot(db, boardId);
  if (snapshot === null) return;
  for (const stream of targets) {
    const role = await roleOnBoard(db, snapshot.board, stream.userId);
    if (role === null || role !== stream.role) {
      stream.write('access.changed', { role });
      stream.end();
      continue;
    }
    const viewer: Viewer = { userId: stream.userId, role };
    const next = snapshot.visibleCardIds(viewer);
    const previous = stream.visible;
    stream.visible = next;

    for (const [cardId, listId] of previous) {
      if (next.has(cardId)) continue;
      stream.write('card.removed', { cardId, counts: snapshot.counts([listId], viewer) });
    }
    for (const [cardId, listId] of next) {
      if (previous.has(cardId)) continue;
      const card = snapshot.cardById(cardId);
      if (card === undefined) continue;
      stream.write('card.created', { card: snapshot.cardPayload(card, viewer), counts: snapshot.counts([listId], viewer) });
    }

    if (signal.type === 'list.created' || signal.type === 'list.updated') {
      const list = snapshot.lists.find((item) => item.id === signal.listId);
      if (list !== undefined) stream.write(signal.type, { list: { id: list.id, name: list.name } });
      continue;
    }
    if (signal.type === 'board.updated') {
      stream.write('board.updated', {
        board: { id: snapshot.board.id, name: snapshot.board.name, visibility: snapshot.board.visibility },
      });
      continue;
    }
    if (signal.type === 'membership') continue;

    const cardId = signal.cardId;
    const wasVisible = previous.has(cardId);
    const isVisible = next.has(cardId);
    if (!wasVisible || !isVisible) continue;
    const card = snapshot.cardById(cardId);
    if (card === undefined) continue;

    if (signal.type === 'card.updated' || signal.type === 'card.created') {
      stream.write('card.updated', { card: snapshot.cardPayload(card, viewer) });
      continue;
    }
    if (signal.type === 'card.moved') {
      const mover = await db.queryOne<{ display_name: string; initials: string; colour: string }>(
        `select display_name, initials, colour from users where id = $1`,
        [signal.moverUserId],
      );
      if (mover === null) continue;
      const visibleBefore = signal.fromOrder.filter(
        (entry) => entry.privateTo.length === 0 || (role !== 'observer' && entry.privateTo.includes(stream.userId)),
      );
      const fromIndex = visibleBefore.findIndex((entry) => entry.id === cardId);
      stream.write('card.moved', {
        card: snapshot.cardPayload(card, viewer),
        from: { listId: signal.fromListId, position: fromIndex === -1 ? null : fromIndex + 1 },
        to: { listId: signal.toListId, position: snapshot.position(cardId, viewer) },
        mover: {
          displayName: mover.display_name,
          initials: mover.initials,
          colour: mover.colour,
        },
        counts: snapshot.counts([signal.fromListId, signal.toListId], viewer),
      });
    }
  }
}

async function dispatchUser(userId: string, signal: UserSignal): Promise<void> {
  const targets = [...streams].filter((stream) => stream.userId === userId);
  for (const stream of targets) {
    if (signal.type === 'session') {
      if (stream.tokenHash === signal.keepTokenHash) continue;
      stream.write('session.ended', {});
      stream.end();
      continue;
    }
    if (stream.boardId !== signal.boardId) continue;
    const snapshot = await loadSnapshot(db, stream.boardId);
    const role = snapshot === null ? null : await roleOnBoard(db, snapshot.board, userId);
    stream.write('access.changed', { role });
    stream.end();
  }
}

export function publishBoardSignal(boardId: string, signal: BoardSignal): void {
  relay.publish(boardChannel(boardId), JSON.stringify({ origin: INSTANCE, signal } satisfies Envelope));
  void dispatchBoard(boardId, signal);
}

export function publishUserSignal(userId: string, signal: UserSignal): void {
  relay.publish(userChannel(userId), JSON.stringify({ origin: INSTANCE, signal } satisfies Envelope));
  void dispatchUser(userId, signal);
}

export function startLive(): void {
  relay.onMessage((channel, payload) => {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(payload) as Envelope;
    } catch {
      return;
    }
    if (envelope.origin === INSTANCE) return;
    const boardPrefix = 'kinfold:board:';
    const userPrefix = 'kinfold:user:';
    if (channel.startsWith(boardPrefix)) {
      void dispatchBoard(channel.slice(boardPrefix.length), envelope.signal as BoardSignal);
      return;
    }
    if (channel.startsWith(userPrefix)) {
      void dispatchUser(channel.slice(userPrefix.length), envelope.signal as UserSignal);
    }
  });
  relay.onStatus((status) => {
    for (const stream of streams) stream.write(status === 'up' ? 'live.resumed' : 'live.paused', {});
  });
  relay.start();
}

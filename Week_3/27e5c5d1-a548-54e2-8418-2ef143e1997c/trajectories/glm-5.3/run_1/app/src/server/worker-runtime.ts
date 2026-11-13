import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { Store, type BoardAccess } from './store.js';
import { StorageService } from './storage-service.js';
import { RelayService, type BoardEventEnvelope, type UserEventEnvelope } from './relay-service.js';

export interface StreamClient {
  boardId: string;
  userId: string;
  role: Role;
  tokenHash: string;
  send: (event: string, data: unknown) => void;
  close: () => void;
  closed: boolean;
}

import type { Role } from '../shared/protocol.js';

/**
 * One worker's runtime: the store, the service seams, and the live stream registry.
 * Events are shaped per recipient at delivery time, with access re-checked on every delivery.
 */
export class WorkerRuntime {
  readonly store: Store;
  readonly storage: StorageService;
  readonly relay: RelayService;
  readonly boardStreams = new Map<string, Set<StreamClient>>();
  readonly userStreams = new Map<string, Set<StreamClient>>();

  constructor(readonly config: AppConfig, readonly workerId: 1 | 2, pool: Pool) {
    this.store = new Store(pool);
    this.storage = new StorageService(config);
    this.relay = new RelayService(config);
  }

  async start(): Promise<void> {
    this.storage.startMonitoring();
    await this.relay.connect();
    this.relay.subscribe((message) => {
      void this.handleRelayMessage(message.channel, message.payload);
    });
  }

  private async handleRelayMessage(channel: string, payload: string): Promise<void> {
    if (channel.startsWith('kinfold:board:')) {
      const boardId = channel.slice('kinfold:board:'.length);
      let envelope: BoardEventEnvelope | null = null;
      try {
        envelope = JSON.parse(payload) as BoardEventEnvelope;
      } catch {
        envelope = null;
      }
      if (envelope) await this.fanOutBoardEvent(boardId, envelope);
    } else if (channel.startsWith('kinfold:user:')) {
      let envelope: UserEventEnvelope | null = null;
      try {
        envelope = JSON.parse(payload) as UserEventEnvelope;
      } catch {
        envelope = null;
      }
      if (envelope) await this.fanOutUserEvent(envelope);
    }
  }

  async fanOutBoardEvent(boardId: string, envelope: BoardEventEnvelope): Promise<void> {
    const clients = this.boardStreams.get(boardId);
    if (!clients || clients.size === 0) return;
    for (const client of [...clients]) {
      if (client.closed) continue;
      try {
        await this.deliverEvent(client, envelope);
      } catch {
        // broken stream cleans itself up on its own poll
      }
    }
  }

  async fanOutUserEvent(envelope: UserEventEnvelope): Promise<void> {
    if (envelope.kind === 'session') {
      const clients = this.userStreams.get(envelope.userId);
      if (!clients) return;
      for (const client of [...clients]) {
        if (client.closed) continue;
        // The session that changed the password stays signed in (DP-06).
        if (envelope.keepTokenHash && client.tokenHash === envelope.keepTokenHash) continue;
        client.send('session.ended', {});
        client.close();
      }
      return;
    }
    if (envelope.kind === 'access') {
      for (const boardId of envelope.boardIds) {
        const clients = this.boardStreams.get(boardId);
        if (!clients) continue;
        for (const client of [...clients]) {
          if (client.closed || client.userId !== envelope.userId) continue;
          const access = await this.store.boardAccess(boardId, envelope.userId);
          if (!access) {
            client.send('access.changed', { role: null });
            client.close();
          } else if (access.role !== client.role) {
            client.role = access.role;
            client.send('access.changed', { role: access.role });
            client.close();
          }
        }
      }
    }
  }

  /** Deliver a change notice to one stream, shaped for that recipient's current access. */
  async deliverEvent(client: StreamClient, envelope: BoardEventEnvelope): Promise<void> {
    const access = await this.store.boardAccess(client.boardId, client.userId);
    if (!access) {
      client.send('access.changed', { role: null });
      client.close();
      return;
    }
    const today = await this.todayFor(access);
    switch (envelope.kind) {
      case 'card.created':
      case 'card.changed': {
        if (!envelope.cardId) return;
        const visible = await this.store.canSeeCard(access, client.userId, envelope.cardId);
        if (!visible) {
          const fromCounts = envelope.fromListId
            ? await this.store.listCounts(access, client.userId, [envelope.fromListId])
            : [];
          client.send('card.removed', { cardId: envelope.cardId, counts: fromCounts });
          return;
        }
        const positions = await this.visiblePositions(access, client.userId);
        const cards = await this.store.shapeCards([envelope.cardId], access.role, today, positions);
        const card = cards.get(envelope.cardId);
        if (!card) return;
        if (envelope.kind === 'card.created') {
          const counts = await this.store.listCounts(access, client.userId, [card.listId]);
          client.send('card.created', { card, counts });
        } else {
          client.send('card.updated', { card });
        }
        return;
      }
      case 'card.moved': {
        if (!envelope.cardId) return;
        const visible = await this.store.canSeeCard(access, client.userId, envelope.cardId);
        const positions = await this.visiblePositions(access, client.userId);
        const card = (await this.store.shapeCards([envelope.cardId], access.role, today, positions)).get(envelope.cardId);
        const fromListId = envelope.fromListId ?? card?.listId ?? '';
        const counts = await this.store.listCounts(access, client.userId, [fromListId, card?.listId ?? ''].filter(Boolean));
        if (!visible || !card) {
          client.send('card.removed', { cardId: envelope.cardId, counts });
          return;
        }
        const mover = envelope.moverUserId ? await this.store.userById(envelope.moverUserId) : null;
        client.send('card.moved', {
          card,
          from: { listId: fromListId, position: envelope.fromPosition ?? 1 },
          to: { listId: card.listId, position: card.position ?? 1 },
          mover: mover
            ? { displayName: mover.displayName, initials: mover.initials, colour: mover.colour }
            : { displayName: '', initials: '', colour: 'sage' },
          counts,
        });
        return;
      }
      case 'card.removed': {
        const counts = envelope.fromListId
          ? await this.store.listCounts(access, client.userId, [envelope.fromListId])
          : [];
        client.send('card.removed', { cardId: envelope.cardId ?? '', counts });
        return;
      }
      case 'list.created': {
        client.send('list.created', { list: { id: envelope.listId ?? '', name: envelope.listName ?? '' } });
        return;
      }
      case 'list.updated': {
        client.send('list.updated', { list: { id: envelope.listId ?? '', name: envelope.listName ?? '' } });
        return;
      }
      case 'board.updated': {
        client.send('board.updated', {
          board: { id: envelope.boardId, name: envelope.boardName ?? '', visibility: envelope.boardVisibility ?? 'workspace' },
        });
        return;
      }
      default:
        return;
    }
  }

  async todayFor(access: BoardAccess): Promise<string> {
    const ws = await this.store.workspaceOnly(access.board.workspaceId);
    return this.store.todayInTimeZone(ws?.timeZone ?? 'UTC');
  }

  /** Positions each visible card holds, per viewer, across the whole board. */
  async visiblePositions(access: BoardAccess, userId: string): Promise<Map<string, number>> {
    const result = await this.store.pool.query(
      `SELECT c.card_id, c.list_id, c.rank FROM kinfold_cards c
       WHERE c.board_id = $1 AND c.status <> 'archived'`,
      [access.board.boardId],
    );
    const rows = result.rows as { card_id: string; list_id: string; rank: number }[];
    const visible = await this.store.visibleCardIds(access, userId, rows.map((r) => r.card_id));
    const byList = new Map<string, { card_id: string; rank: number }[]>();
    for (const row of rows) {
      if (!visible.has(row.card_id)) continue;
      const bucket = byList.get(row.list_id) ?? [];
      bucket.push(row);
      byList.set(row.list_id, bucket);
    }
    const positions = new Map<string, number>();
    for (const [, bucket] of byList) {
      bucket.sort((a, b) => a.rank - b.rank);
      for (const [index, card] of bucket.entries()) positions.set(card.card_id, index + 1);
    }
    return positions;
  }

  registerBoardStream(client: StreamClient): void {
    let set = this.boardStreams.get(client.boardId);
    if (!set) {
      set = new Set();
      this.boardStreams.set(client.boardId, set);
    }
    set.add(client);
    let userSet = this.userStreams.get(client.userId);
    if (!userSet) {
      userSet = new Set();
      this.userStreams.set(client.userId, userSet);
    }
    userSet.add(client);
  }

  unregisterBoardStream(client: StreamClient): void {
    this.boardStreams.get(client.boardId)?.delete(client);
    this.userStreams.get(client.userId)?.delete(client);
  }
}

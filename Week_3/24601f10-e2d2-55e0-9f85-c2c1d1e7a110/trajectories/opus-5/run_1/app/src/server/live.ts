import type { WebSocket } from 'ws';

import type { ApiMatch, ApiTournament, LiveMessage, LiveMessageType, Role } from '../shared/types';
import { nowIso } from './clock';
import type { Db } from './db';

export type Audience = 'all' | 'organizers';

export interface PendingMessage {
  type: LiveMessageType;
  audience: Audience;
  data: LiveMessage['data'];
}

export interface StoredMessage extends LiveMessage {
  audience: Audience;
}

export class Outbox {
  readonly items: PendingMessage[] = [];

  add(type: LiveMessageType, data: LiveMessage['data'], audience: Audience = 'all'): void {
    this.items.push({ type, data, audience });
  }

  announce(text: string): void {
    this.items.push({ type: 'announcement', data: { text }, audience: 'all' });
  }
}

export interface Viewer {
  tournamentId: string;
  role: Role;
  spectator: boolean;
  shareCode: string | null;
}

const isOrganizer = (viewer: Viewer): boolean => viewer.role === 'organizer' || viewer.role === 'co_organizer';

const publicMatch = (match: ApiMatch): ApiMatch => {
  const { overdue, updated_by, ...rest } = match;
  void overdue;
  void updated_by;
  return rest;
};

const shapeTournament = (tournament: ApiTournament, viewer: Viewer): ApiTournament => {
  const shaped: ApiTournament = { ...tournament, my_role: viewer.spectator ? 'viewer' : viewer.role };
  if (!isOrganizer(viewer)) {
    delete shaped.share_url;
    delete shaped.co_organizers;
  }
  return shaped;
};

const shape = (message: StoredMessage, viewer: Viewer): LiveMessage | null => {
  if (message.audience === 'organizers' && !isOrganizer(viewer)) return null;
  const data: LiveMessage['data'] = { ...message.data };
  if (!isOrganizer(viewer)) {
    if (data.match !== undefined) data.match = publicMatch(data.match);
    if (data.matches !== undefined) data.matches = data.matches.map(publicMatch);
  }
  if (data.tournament !== undefined) data.tournament = shapeTournament(data.tournament, viewer);
  if (viewer.spectator && data.entrants !== undefined) {
    data.entrants = (data.entrants as { name: string; seed: number }[]).map((entrant) => ({
      name: entrant.name,
      seed: entrant.seed,
    }));
  }
  return { seq: message.seq, type: message.type, at: message.at, data };
};

interface Connection {
  socket: WebSocket;
  viewer: Viewer;
}

const connections = new Set<Connection>();

export const addConnection = (socket: WebSocket, viewer: Viewer): void => {
  const connection: Connection = { socket, viewer };
  connections.add(connection);
  socket.on('close', () => connections.delete(connection));
  socket.on('error', () => connections.delete(connection));
};

export const publish = (tournamentId: string, messages: StoredMessage[]): void => {
  if (messages.length === 0) return;
  for (const connection of connections) {
    if (connection.viewer.tournamentId !== tournamentId) continue;
    for (const message of messages) {
      const shaped = shape(message, connection.viewer);
      if (shaped === null) continue;
      try {
        connection.socket.send(JSON.stringify(shaped));
      } catch {
        connections.delete(connection);
      }
    }
  }
};

/** A replaced share link kills its open live connections at once. */
export const closeShareSockets = (tournamentId: string, shareCode: string): void => {
  for (const connection of [...connections]) {
    if (connection.viewer.tournamentId === tournamentId && connection.viewer.shareCode === shareCode) {
      connection.socket.close(4404, 'link_replaced');
      connections.delete(connection);
    }
  }
};

export const flushOutbox = async (db: Db, tournamentId: string, outbox: Outbox): Promise<StoredMessage[]> => {
  const stored: StoredMessage[] = [];
  for (const item of outbox.items) {
    const { rows } = await db.query<{ last_seq: number }>(
      'update tournaments set last_seq = last_seq + 1 where id = $1 returning last_seq',
      [tournamentId],
    );
    const seq = rows[0]?.last_seq ?? 0;
    const at = nowIso();
    await db.query(
      'insert into live_messages (tournament_id, seq, type, audience, data, at) values ($1, $2, $3, $4, $5, $6)',
      [tournamentId, seq, item.type, item.audience, JSON.stringify(item.data), new Date(at)],
    );
    stored.push({ seq, type: item.type, at, data: item.data, audience: item.audience });
  }
  outbox.items.length = 0;
  return stored;
};

export const replayFor = async (db: Db, tournamentId: string, after: number, viewer: Viewer): Promise<LiveMessage[]> => {
  const { rows } = await db.query<{ seq: number; type: LiveMessageType; audience: Audience; data: LiveMessage['data']; at: Date }>(
    'select seq, type, audience, data, at from live_messages where tournament_id = $1 and seq > $2 order by seq',
    [tournamentId, after],
  );
  const messages: LiveMessage[] = [];
  for (const row of rows) {
    const shaped = shape({ seq: row.seq, type: row.type, at: row.at.toISOString(), data: row.data, audience: row.audience }, viewer);
    if (shaped !== null) messages.push(shaped);
  }
  return messages;
};

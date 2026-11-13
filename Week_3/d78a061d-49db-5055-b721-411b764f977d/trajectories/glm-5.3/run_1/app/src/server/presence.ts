import { query } from './db.js';

/**
 * Presence and connection-loss rules (DP-37, DP-49, DP-76), decided here.
 * An account is online while any of its connections last heartbeated within 30 seconds.
 */
export type Connection = {
  accountId: string;
  lastHeartbeat: number;
  lastPing: number;
  joinedSessions: Set<string>;
  alive: boolean;
};

export const connections = new Set<Connection>();

export function openConnection(accountId: string): Connection {
  const conn: Connection = {
    accountId,
    lastHeartbeat: Date.now(),
    lastPing: Date.now(),
    joinedSessions: new Set(),
    alive: true,
  };
  connections.add(conn);
  return conn;
}

export function closeConnection(conn: Connection): void {
  conn.alive = false;
  connections.delete(conn);
  void afterConnectionLoss(conn);
}

async function afterConnectionLoss(conn: Connection): Promise<void> {
  const sessions = [...conn.joinedSessions];
  for (const sessionId of sessions) {
    const { onMemberConnectionsChanged } = await import('./world-conn.js');
    await onMemberConnectionsChanged(sessionId, conn.accountId);
  }
}

export function heartbeat(conn: Connection): void {
  conn.lastHeartbeat = Date.now();
}

export function isAccountOnline(accountId: string): boolean {
  const cutoff = Date.now() - 30_000;
  for (const conn of connections) {
    if (conn.accountId === accountId && conn.alive && conn.lastHeartbeat >= cutoff) return true;
  }
  return false;
}

export function sessionConnectionCount(sessionId: string, accountId: string): number {
  let count = 0;
  for (const conn of connections) {
    if (conn.accountId === accountId && conn.alive && conn.joinedSessions.has(sessionId)) count++;
  }
  return count;
}

/** The party member connection value (DP-76), decided in this one function. */
export function partyMemberConnection(accountId: string, sessionId: string | null): 'connected' | 'dropped' | 'offline' {
  if (sessionId) {
    const { sessionState } = require('./world.js') as typeof import('./world.js');
    const state = sessionState(sessionId);
    const member = state?.members.find((m) => m.account_id === accountId);
    if (member && member.status === 'dropped') {
      if (member.graceUntil && member.graceUntil > Date.now()) return 'dropped';
    }
  }
  return isAccountOnline(accountId) ? 'connected' : 'offline';
}

export function connectionsForAccount(accountId: string): Connection[] {
  return [...connections].filter((c) => c.accountId === accountId && c.alive);
}

export function openSessionConnections(sessionId: string): Connection[] {
  return [...connections].filter((c) => c.alive && c.joinedSessions.has(sessionId));
}

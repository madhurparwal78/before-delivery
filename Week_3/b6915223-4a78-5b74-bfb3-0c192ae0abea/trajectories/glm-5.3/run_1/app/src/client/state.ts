import type { SquadView } from './api';

export interface AppState {
  me: { id: string; email: string; team_name: string; role: 'manager' | 'operator' } | null;
  squad: SquadView | null;
  hasSquad: boolean;
  hasSquadKnown: boolean;
  current: { number: number; status: string; deadline_local: string | null } | null;
  noticesUnread: number;
  noticesInbox: 'ready' | 'unavailable';
}

export interface AnnounceTarget {
  announce(text: string): void;
}

export function gameweekStatusLine(current: { number: number; status: string; deadline_local: string | null } | null): string {
  if (current === null) return 'Gameweek 1 · Open · Deadline not set';
  const label = current.status === 'closed' ? 'Closed' : current.status[0].toUpperCase() + current.status.slice(1);
  if (current.status === 'open') {
    return current.deadline_local === null
      ? `Gameweek ${current.number} · Open · Deadline not set`
      : `Gameweek ${current.number} · Open · Deadline ${current.deadline_local}`;
  }
  return `Gameweek ${current.number} · ${label}`;
}

export const LOCKED_BANNER = (n: number): string =>
  `Gameweek ${n} is locked. Pick Team and Transfers reopen when the next gameweek opens.`;

export const DEADLINE_COPY = (n: number): string =>
  `Deadline passed. Gameweek ${n} is locked, so this change was not saved.`;

export const RECEIPT_STORED = 'Team locked, receipt stored';
export const RECEIPT_PENDING = 'Receipt pending. Your locked team is safe; the file will be stored when storage is back.';

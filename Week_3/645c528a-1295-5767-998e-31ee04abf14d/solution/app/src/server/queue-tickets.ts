/** Queue tickets, held in the server's memory. A ticket is one player's place in a mode and tier until a partner fits. */
import type { Mode } from '../shared/domain';

export interface Ticket {
  ticketId: string;
  playerId: string;
  sessionId: string;
  mode: Mode;
  tier: number;
  level: number;
  queuedAt: number;
  announcedBand: number;
}

export const tickets = new Map<string, Ticket>();
export const pairedTables = new Map<string, string>();

export function isQueued(playerId: string): boolean {
  return tickets.has(playerId);
}

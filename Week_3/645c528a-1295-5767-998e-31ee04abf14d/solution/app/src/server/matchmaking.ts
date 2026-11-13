import { randomUUID } from 'node:crypto';
import { MODES, NO_GUIDELINES_MIN_LEVEL, TIERS, type Mode } from '../shared/domain';
import { playerById } from './auth';
import { transaction } from './db';
import { ApiError, tierLocked, validationFailed } from './errors';
import { route } from './http';
import { balance } from './ledger';
import { pairedTables, tickets, type Ticket } from './queue-tickets';
import { notifyPlayer, sendToPlayer } from './realtime';
import { NOT_ENOUGH_COINS, activeTableUrl, inLiveMatch, openRoom, seatFor } from './tables';

const BAND_START = 3;
const BAND_STEP = 3;
const BAND_STEP_MS = 10_000;

function bandOf(ticket: Ticket, now: number): number {
  return BAND_START + BAND_STEP * Math.floor((now - ticket.queuedAt) / BAND_STEP_MS);
}

function refuseTicket(ticket: Ticket): void {
  tickets.delete(ticket.playerId);
  sendToPlayer(ticket.playerId, { topic: 'queue', status: 'refused', message: NOT_ENOUGH_COINS });
}

async function pair(first: Ticket, second: Ticket): Promise<void> {
  const entry = TIERS[first.tier - 1].entry;
  const tableUrl = await transaction(async (client) => {
    const held = [await balance(client, first.playerId, 'coins'), await balance(client, second.playerId, 'coins')];
    const short = [first, second].filter((_, index) => held[index] < entry);
    if (short.length > 0) {
      short.forEach(refuseTicket);
      return null;
    }
    const seats = [await seatFor(client, first.playerId, first.sessionId), await seatFor(client, second.playerId, second.sessionId)];
    const room = await openRoom(client, { kind: 'stake', mode: first.mode, tier: first.tier, seats });
    return `/table/${room.id}`;
  });
  if (tableUrl === null) return;
  for (const ticket of [first, second]) {
    tickets.delete(ticket.playerId);
    pairedTables.set(ticket.playerId, tableUrl);
    sendToPlayer(ticket.playerId, { topic: 'queue', status: 'paired', tableUrl });
    notifyPlayer(ticket.playerId);
  }
}

let sweeping = false;

/** Pairs the longest-waiting fits; the first-queued player takes seat 1 and breaks. */
export async function sweepQueue(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    const waiting = [...tickets.values()].sort((a, b) => a.queuedAt - b.queuedAt);
    const taken = new Set<string>();
    for (let i = 0; i < waiting.length; i += 1) {
      const first = waiting[i];
      if (taken.has(first.playerId)) continue;
      const band = bandOf(first, now);
      const partner = waiting.slice(i + 1).find((other) =>
        !taken.has(other.playerId) && other.mode === first.mode && other.tier === first.tier && Math.abs(other.level - first.level) <= band);
      if (partner !== undefined) {
        taken.add(first.playerId);
        taken.add(partner.playerId);
        await pair(first, partner);
      } else if (band !== first.announcedBand) {
        first.announcedBand = band;
        sendToPlayer(first.playerId, { topic: 'queue', status: 'queued', band });
      }
    }
  } finally {
    sweeping = false;
  }
}

export function leaveQueueOnDisconnect(playerId: string): void {
  tickets.delete(playerId);
}

export function registerQueueRoutes(): void {
  route('POST', '/api/queue', async ({ session, body }) => {
    const mode = body.mode as Mode;
    const tier = TIERS.find((candidate) => candidate.tier === body.tier);
    const errors: Record<string, string> = {};
    if (!MODES.includes(mode)) errors.mode = 'Choose a mode.';
    if (tier === undefined) errors.tier = 'Choose a tier from 1 to 5.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const chosen = tier as (typeof TIERS)[number];
    const ticket = await transaction(async (client) => {
      const player = await playerById(client, session.playerId);
      if (player.level < chosen.minLevel) throw tierLocked(chosen.minLevel);
      if (mode === 'no-guidelines' && player.level < NO_GUIDELINES_MIN_LEVEL) throw new ApiError(403, 'mode_locked', `Unlocks at level ${NO_GUIDELINES_MIN_LEVEL}`);
      if (inLiveMatch(session.playerId)) throw new ApiError(409, 'in_match', 'You are already in a match.');
      if (tickets.has(session.playerId)) throw new ApiError(409, 'already_queued', 'You are already in the queue.');
      if ((await balance(client, session.playerId, 'coins')) < chosen.entry) throw new ApiError(409, 'insufficient_coins', NOT_ENOUGH_COINS);
      return {
        ticketId: randomUUID(), playerId: session.playerId, sessionId: session.id, mode, tier: chosen.tier,
        level: player.level, queuedAt: Date.now(), announcedBand: BAND_START,
      };
    });
    // The transaction awaited, so a simultaneous request may have taken the place since the check above.
    if (tickets.has(session.playerId)) throw new ApiError(409, 'already_queued', 'You are already in the queue.');
    tickets.set(session.playerId, ticket);
    pairedTables.delete(session.playerId);
    void sweepQueue().catch((error: unknown) => console.error(error));
    return { status: 201, body: { ticketId: ticket.ticketId, status: 'queued' } };
  }, { body: true });

  route('GET', '/api/queue', async ({ session }) => {
    const ticket = tickets.get(session.playerId);
    if (ticket !== undefined) return { status: 200, body: { status: 'queued', band: bandOf(ticket, Date.now()) } };
    const tableUrl = activeTableUrl(session.playerId) === pairedTables.get(session.playerId) ? pairedTables.get(session.playerId) : undefined;
    return { status: 200, body: tableUrl === undefined ? { status: 'none' } : { status: 'paired', tableUrl } };
  });

  route('DELETE', '/api/queue', async ({ session }) => {
    if (tickets.delete(session.playerId)) return { status: 200, body: { status: 'cancelled' } };
    if (activeTableUrl(session.playerId) !== null && pairedTables.has(session.playerId)) {
      throw new ApiError(409, 'already_paired', 'You are already paired.');
    }
    throw new ApiError(409, 'not_queued', 'You are not in the queue.');
  });
}

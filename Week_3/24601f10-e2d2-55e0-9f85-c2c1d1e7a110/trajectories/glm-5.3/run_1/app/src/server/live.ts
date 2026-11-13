import { all, one, query } from "./db.js";
import type { LiveMessage, LiveMessageType } from "../shared/types.js";
import { isoNow } from "./auth.js";

export interface LiveClient {
  id: string;
  tournamentId: string;
  send: (msg: LiveMessage) => void;
  isOrganizer: boolean;
  isShare: boolean;
}

const clients = new Set<LiveClient>();

export function addClient(c: LiveClient): void {
  clients.add(c);
}
export function removeClient(c: LiveClient): void {
  clients.delete(c);
}

/** Record a message to the per-tournament log and broadcast it. */
export async function recordMessage(
  tournamentId: string,
  type: LiveMessageType,
  data: Record<string, unknown>
): Promise<number> {
  const at = isoNow();
  const row = await one<{ seq: string }>(
    `INSERT INTO live_seq (tournament_id, seq) VALUES ($1, 1)
     ON CONFLICT (tournament_id) DO UPDATE SET seq = live_seq.seq + 1
     RETURNING seq`,
    [tournamentId]
  );
  const seq = Number(row!.seq);
  await query(
    `INSERT INTO live_messages (tournament_id, seq, type, data, at) VALUES ($1,$2,$3,$4,$5)`,
    [tournamentId, seq, type, JSON.stringify(data), at]
  );
  const msg: LiveMessage = { seq, type, at, data: data as LiveMessage["data"] };
  for (const c of clients) {
    if (c.tournamentId === tournamentId) c.send(shapeFor(c, msg));
  }
  return seq;
}

export function shapeFor(c: LiveClient, msg: LiveMessage): LiveMessage {
  if (!c.isShare && !c.isOrganizer) {
    // signed-in non-organizer viewer: strip nothing (match objects already shaped)
    return msg;
  }
  if (c.isShare) {
    return shapeShare(msg);
  }
  return msg;
}

function shapeShare(msg: LiveMessage): LiveMessage {
  const data = { ...(msg.data as Record<string, unknown>) };
  if (data.tournament) {
    data.tournament = shapeShareTournament(data.tournament as Record<string, unknown>);
  }
  // public shape: display names, scores, states and labels only; never usernames,
  // account ids, overdue, updated_by, share_url or co-organizers
  if (data.match) {
    data.match = shapeShareMatch(data.match as Record<string, unknown>);
  }
  if (Array.isArray(data.matches)) {
    data.matches = (data.matches as Record<string, unknown>[]).map(shapeShareMatch);
  }
  if (data.entrants) {
    data.entrants = (data.entrants as Record<string, unknown>[]).map((e) => ({
      id: e.id,
      name: e.name,
      seed: e.seed,
      checked_in: e.checked_in,
    }));
  }
  return { ...msg, data: data as LiveMessage["data"] };
}

function shapeShareMatch(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["id", "tournament_id", "label", "bracket", "round", "number", "state",
    "upper_games", "lower_games", "winner", "report", "dispute", "called_at", "version"]) {
    if (k in m) out[k] = m[k];
  }
  const stripSlot = (slot: unknown): unknown => {
    if (slot === null) return null;
    const s = slot as Record<string, unknown>;
    if ("bye" in s) return { bye: true };
    return { name: s.name };
  };
  out.upper = stripSlot(m.upper);
  out.lower = stripSlot(m.lower);
  return out;
}

function shapeShareTournament(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [
    "id", "name", "format", "state", "fill", "time_zone",
    "server_time", "field_size", "entrant_count", "checked_in_count",
    "current_round", "swiss_rounds", "logo_url",
  ]) {
    if (k in t) out[k] = t[k];
  }
  return out;
}

export async function replayFrom(tournamentId: string, after: number, send: (msg: LiveMessage) => void): Promise<void> {
  const rows = await all<{ seq: string; type: string; data: unknown; at: string }>(
    `SELECT seq, type, data, at FROM live_messages WHERE tournament_id = $1 AND seq > $2 ORDER BY seq`,
    [tournamentId, after]
  );
  for (const r of rows) {
    send({ seq: Number(r.seq), type: r.type as LiveMessageType, at: r.at, data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as LiveMessage["data"] });
  }
}

export async function broadcast(tournamentId: string, msg: { type: LiveMessageType; data: Record<string, unknown> }): Promise<void> {
  await recordMessage(tournamentId, msg.type, msg.data);
}

export async function latestSeq(tournamentId: string): Promise<number> {
  const r = await one<{ seq: string }>(`SELECT seq FROM live_messages WHERE tournament_id = $1`, [tournamentId]);
  return r ? Number(r.seq) : 0;
}

import { randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { query, type Queryable } from '../db.js';
import { isUuid } from '../ids.js';
import { publish } from '../live.js';
import type { PlayerRow } from './players.js';

export const NOTE_LIMIT = 140;
export const REASONS = ['Not about the islands', 'Unkind', 'Shares personal details'];

export type Note = {
  id: string;
  text: string;
  author_name: string;
  status: 'pending' | 'approved' | 'declined';
  reason: string | null;
};

type NoteRow = Note & { author_id: string; world_id: string; decided_by: string | null };

export function checkNoteText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError('note_empty');
  if ([...value].length > NOTE_LIMIT) throw new ApiError('note_too_long');
  return value;
}

export async function visibleNotes(worldId: string, viewerId: string): Promise<Note[]> {
  const found = await query<Note>(
    `SELECT notes.id, notes.text, players.name AS author_name, notes.status, notes.reason
       FROM notes JOIN players ON players.id = notes.author_id
      WHERE notes.world_id = $1 AND (notes.status = 'approved' OR notes.author_id = $2)
      ORDER BY notes.created_at ASC`,
    [worldId, viewerId],
  );
  return found.rows;
}

export async function pendingNotes(worldId: string): Promise<Note[]> {
  const found = await query<Note>(
    `SELECT notes.id, notes.text, players.name AS author_name, notes.status, notes.reason
       FROM notes JOIN players ON players.id = notes.author_id
      WHERE notes.world_id = $1 AND notes.status = 'pending'
      ORDER BY notes.created_at ASC`,
    [worldId],
  );
  return found.rows;
}

export async function pinNote(player: PlayerRow, text: string): Promise<Note> {
  if (!player.confirmed) throw new ApiError('unconfirmed');
  const id = randomUUID();
  await query('INSERT INTO notes (id, world_id, author_id, text) VALUES ($1, $2, $3, $4)', [
    id,
    player.world_id,
    player.id,
    text,
  ]);
  return { id, text, author_name: player.name, status: 'pending', reason: null };
}

async function noteRow(db: Queryable, id: string): Promise<NoteRow> {
  if (!isUuid(id)) throw new ApiError('not_found');
  const found = await db.query<NoteRow>(
    `SELECT notes.*, players.name AS author_name FROM notes JOIN players ON players.id = notes.author_id WHERE notes.id = $1`,
    [id],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found');
  return row;
}

async function decidedBlock(row: NoteRow): Promise<never> {
  const ranger = row.decided_by
    ? await query<{ name: string }>('SELECT name FROM players WHERE id = $1', [row.decided_by])
    : null;
  throw new ApiError('note_decided', {
    outcome: row.status,
    rangerName: ranger?.rows[0]?.name ?? 'a ranger',
  });
}

export async function approveNote(ranger: PlayerRow, id: string): Promise<Note> {
  const row = await noteRow({ query }, id);
  if (!ranger.ranger) throw new ApiError('not_ranger');
  if (row.status !== 'pending') await decidedBlock(row);
  const decided = await query<NoteRow>(
    `UPDATE notes SET status = 'approved', decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, ranger.id],
  );
  if (decided.rowCount === 0) await decidedBlock(await noteRow({ query }, id));
  await publish({ query }, row.world_id, null, 'note', {
    event: 'approved',
    author_id: row.author_id,
    note: { id: row.id, text: row.text, author_name: row.author_name, status: 'approved', reason: null },
  });
  await publish({ query }, row.world_id, row.author_id, 'note', { event: 'yours_approved', id: row.id });
  return { id: row.id, text: row.text, author_name: row.author_name, status: 'approved', reason: null };
}

export async function declineNote(ranger: PlayerRow, id: string, reason: unknown): Promise<Note> {
  const row = await noteRow({ query }, id);
  if (!ranger.ranger) throw new ApiError('not_ranger');
  if (row.status !== 'pending') await decidedBlock(row);
  if (typeof reason !== 'string' || !REASONS.includes(reason)) throw new ApiError('bad_reason');
  const decided = await query<NoteRow>(
    `UPDATE notes SET status = 'declined', reason = $3, decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, ranger.id, reason],
  );
  if (decided.rowCount === 0) await decidedBlock(await noteRow({ query }, id));
  await publish({ query }, row.world_id, row.author_id, 'note', { event: 'yours_declined', id: row.id, reason });
  return { id: row.id, text: row.text, author_name: row.author_name, status: 'declined', reason };
}

export async function removeNote(ranger: PlayerRow, id: string): Promise<void> {
  const row = await noteRow({ query }, id);
  if (!ranger.ranger) throw new ApiError('not_ranger');
  if (row.status !== 'approved') throw new ApiError('note_not_approved');
  await query('DELETE FROM notes WHERE id = $1', [id]);
  await publish({ query }, row.world_id, null, 'note', { event: 'removed', id });
}

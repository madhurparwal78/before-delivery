// Presence: where another device's caret sits in a block, kept per session and block.
import { db, one } from './db.ts';
import { broadcastUnnumbered } from './events.ts';
import { transformOffset } from '../shared/ot.ts';
import { editText } from '../shared/richtext.ts';
import { FieldErrors } from './errors.ts';

const PRESENCE_TTL_MS = 30_000;
const timers = new Map<string, NodeJS.Timeout>();
const timerKey = (sessionId: string, blockId: string): string => `${sessionId}/${blockId}`;

interface PresenceRow { session_id: string; block_id: string; label: string }

function announceDrop(sessionId: string, blockId: string, label: string): void {
  broadcastUnnumbered('presence.changed', { block_id: blockId, session_id: sessionId, label, anchor: null, head: null });
}

async function drop(where: string, params: unknown[]): Promise<void> {
  const rows = await db.query<PresenceRow>(
    `DELETE FROM presence p USING device_sessions s WHERE s.id = p.session_id AND ${where} RETURNING p.session_id, p.block_id, s.label`, params);
  for (const r of rows) {
    clearTimeout(timers.get(timerKey(r.session_id, r.block_id)));
    timers.delete(timerKey(r.session_id, r.block_id));
    announceDrop(r.session_id, r.block_id, r.label);
  }
}

export const dropPresence = (sessionId: string, blockId: string): Promise<void> =>
  drop('p.session_id = $1 AND p.block_id = $2', [sessionId, blockId]);
export const dropSessionPresence = (sessionId: string): Promise<void> => drop('p.session_id = $1', [sessionId]);

/** Records a presence report made against `version`, moved to the block's current edit text. */
export async function reportPresence(session: { id: string; label: string }, blockId: string, body: Record<string, unknown>): Promise<void> {
  const { anchor, head, version } = body;
  const errors = new FieldErrors();
  const base = Number.isInteger(version)
    ? await one<{ body: string }>(db, 'SELECT body FROM revisions WHERE block_id = $1 AND version = $2', [blockId, version])
    : undefined;
  const length = base ? editText(base.body).length : -1;
  const inside = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= length;
  if (!inside(anchor)) errors.add('anchor', 'Use offsets inside the block.');
  if (!inside(head)) errors.add('head', 'Use offsets inside the block.');
  errors.throwIfAny();
  const later = await db.query<{ ops: null; body: string } | { ops: unknown; body: string }>(
    'SELECT ops, body FROM revisions WHERE block_id = $1 AND version > $2 ORDER BY version', [blockId, version]);
  let a = anchor as number;
  let h = head as number;
  for (const rev of later) {
    if (Array.isArray(rev.ops)) {
      a = transformOffset(a, rev.ops);
      h = transformOffset(h, rev.ops);
    } else {
      const len = editText(rev.body).length;
      a = Math.min(a, len);
      h = Math.min(h, len);
    }
  }
  const current = (version as number) + later.length;
  await db.query(
    `INSERT INTO presence (session_id, block_id, anchor, head, version, reported_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (session_id, block_id) DO UPDATE SET anchor = $3, head = $4, version = $5, reported_at = now()`,
    [session.id, blockId, a, h, current]);
  broadcastUnnumbered('presence.changed', { block_id: blockId, session_id: session.id, label: session.label, anchor: a, head: h });
  const key = timerKey(session.id, blockId);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => void dropPresence(session.id, blockId), PRESENCE_TTL_MS));
}

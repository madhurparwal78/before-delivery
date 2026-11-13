import { pool } from './db.js';
import { uid32 } from './ids.js';
import { chainOrder } from '../shared/chain.js';
import { mss, mmss, figures } from '../shared/units.js';
import { asNodeLike } from './room-service.js';
import { loadSession, sessionSolves } from './session-service.js';
import type { Debrief } from '../shared/types.js';

export async function buildDebrief(sessionId: string): Promise<Debrief | null> {
  const loaded = await loadSession(sessionId);
  if (!loaded || loaded.row.state !== 'ended') return null;
  const nodesRow = await pool.query(`SELECT * FROM trigger_nodes WHERE room_id = $1`, [loaded.row.room_id]);
  const nodes = asNodeLike(nodesRow.rows);
  const ordered = chainOrder(nodes);
  const solves = await sessionSolves(sessionId);
  const startMs = loaded.row.started_at ? new Date(loaded.row.started_at).getTime() : 0;
  const endMs = loaded.row.ended_at ? new Date(loaded.row.ended_at).getTime() : Date.now();
  const elapsed = Math.max(0, Math.floor((endMs - startMs) / 1000));

  const solveAt = new Map(solves.map((s) => [s.nodeId, s.elapsedSeconds]));
  const puzzles = ordered
    .filter((n) => n.kind === 'puzzle' || n.kind === 'exit')
    .map((n) => {
      const at = solveAt.get(n.id);
      if (at === undefined) return { title: n.title, solvedAtSeconds: null, waitSeconds: null };
      // available from the start or after its last prerequisite's solve
      let avail = 0;
      for (const p of n.prerequisites) {
        const pt = solveAt.get(p);
        if (pt !== undefined && pt > avail) avail = pt;
      }
      return { title: n.title, solvedAtSeconds: at, waitSeconds: Math.max(0, at - avail) };
    });

  let chokePoint: Debrief['chokePoint'] = null;
  let bestWait = -1;
  let chokeRank = Infinity;
  const rank = new Map(ordered.map((n, i) => [n.id, i]));
  for (const p of puzzles) {
    if (p.waitSeconds === null) continue;
    const node = ordered.find((n) => n.title === p.title);
    if (!node) continue;
    const idx = rank.get(node.id)!;
    if (p.waitSeconds > bestWait || (p.waitSeconds === bestWait && idx < chokeRank)) {
      bestWait = p.waitSeconds;
      chokeRank = idx;
      chokePoint = { title: p.title, waitSeconds: p.waitSeconds };
    }
  }

  const hintsRow = await pool.query(`SELECT count(*) AS n FROM hints WHERE session_id = $1`, [sessionId]);
  const { roomStats } = await import('./room-service.js');
  const stats = await roomStats(loaded.row.room_id);

  const emailRows = await pool.query(
    `SELECT COALESCE(bool_or(status = 'failed'), false) AS any_failed,
            COALESCE(bool_or(status = 'queued'), false) AS any_queued
     FROM emails WHERE session_id = $1 AND kind = 'debrief'`,
    [sessionId]
  );
  const ef = emailRows.rows[0];
  const emailStatus: Debrief['emailStatus'] =
    (ef?.any_failed && 'failed') || (ef?.any_queued && 'queued') || (emailRows.rows.length ? 'sent' : 'queued');

  return {
    outcome: loaded.row.outcome ?? 'stopped',
    elapsedSeconds: elapsed,
    stats,
    puzzles,
    hintsUsed: Number(hintsRow.rows[0].n),
    chokePoint,
    emailStatus,
  };
}

/** Queues and sends the debrief mail within 10 seconds of the end. */
export async function sendDebrief(sessionId: string): Promise<void> {
  const loaded = await loadSession(sessionId);
  if (!loaded) return;
  const debrief = await buildDebrief(sessionId);
  if (!debrief) return;
  const roomName = loaded.roomName;

  const outcomeLine =
    debrief.outcome === 'escaped'
      ? `Escaped in ${mmss(debrief.elapsedSeconds)}`
      : debrief.outcome === 'timed_out'
        ? 'Out of time'
        : `Stopped at ${mmss(debrief.elapsedSeconds)}`;

  const lines = [
    outcomeLine,
    figures(debrief.stats),
    ...debrief.puzzles.map((p) =>
      p.solvedAtSeconds === null ? `${p.title} — not solved` : `${p.title} — ${mmss(p.solvedAtSeconds)}`
    ),
    `Hints used: ${debrief.hintsUsed}`,
    debrief.chokePoint
      ? `Choke point: ${debrief.chokePoint.title} (${mss(debrief.chokePoint.waitSeconds)} waiting)`
      : `Choke point: none`,
  ];
  const body = lines.join('\n');
  const subject = `Playtest debrief: ${roomName}`;

  const rows = await pool.query(
    `SELECT DISTINCT email FROM (
       SELECT i.email FROM invites i WHERE i.session_id = $1 AND i.revoked = false
       UNION SELECT u.email FROM users u WHERE u.id = $2
       UNION SELECT u.email FROM sessions s JOIN rooms r ON r.id = s.room_id JOIN workspaces w ON w.id = r.workspace_id
               JOIN users u ON u.workspace_id = w.id AND u.role = 'owner' WHERE s.id = $1 AND u.role = 'owner'
     ) t`,
    [sessionId, loaded.row.host_user_id]
  );
  const emails = rows.rows.map((r) => r.email as string);

  const existing = await pool.query(`SELECT id FROM emails WHERE session_id = $1 AND kind = 'debrief' LIMIT 1`, [sessionId]);
  if (existing.rows.length) return; // already queued/sent

  for (const email of emails) {
    await pool.query(
      `INSERT INTO emails (id, kind, recipient, subject, body, session_id, status, attempts, next_attempt)
       VALUES ($1,'debrief',$2,$3,$4,$5,'queued',0,now())`,
      [uid32(), email, subject, body, sessionId]
    );
  }
}


import { ballotIncomplete, badScore, ballotSubmitted, notFound, roundClosed } from '../copy';
import { loadCategory, loadProgram, loadRound } from '../data';
import { inTransaction, pool, withLock } from '../db';
import { cutoffInstant, dateLabel, withOffset } from '../domain/time';
import type { RoundRow } from '../domain/types';
import { invalid } from '../http/errors';
import { json, requireRole, route, type Ctx, type Reply } from '../http/router';
import { text } from '../http/validate';

const CRITERIA = ['craft', 'clarity', 'idea', 'story'] as const;

async function panelRound(ctx: Ctx, roundId: string): Promise<{ round: RoundRow; jurorId: string }> {
  const round = await loadRound(pool, roundId);
  if (round === null) throw notFound();
  const actor = requireRole(ctx, 'juror');
  const member = await pool.query('SELECT 1 FROM panel_members WHERE round_id = $1 AND juror_id = $2', [
    round.id,
    actor.id,
  ]);
  if (member.rowCount === 0 || round.state === 'scheduled') throw notFound();
  return { round, jurorId: actor.id };
}

async function ballotCounts(roundId: string, jurorId: string): Promise<{ assigned: number; scored: number; submitted: boolean }> {
  const counts = await pool.query<{ assigned: string; scored: string }>(
    `SELECT count(*) AS assigned, count(s.entry_id) AS scored
     FROM assignments a
     LEFT JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
     WHERE a.round_id = $1 AND a.juror_id = $2 AND a.recused_at IS NULL`,
    [roundId, jurorId],
  );
  const member = await pool.query<{ ballot_submitted_at: Date | null }>(
    'SELECT ballot_submitted_at FROM panel_members WHERE round_id = $1 AND juror_id = $2',
    [roundId, jurorId],
  );
  return {
    assigned: Number(counts.rows[0].assigned),
    scored: Number(counts.rows[0].scored),
    submitted: member.rows[0].ballot_submitted_at !== null,
  };
}

async function jurorRounds(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'juror');
  const result = await pool.query<{
    id: string;
    name: string;
    category_name: string;
    ballot_deadline: string | null;
    time_zone: string;
  }>(
    `SELECT r.id, r.name, c.name AS category_name, r.ballot_deadline, p.time_zone
     FROM rounds r
     JOIN categories c ON c.id = r.category_id
     JOIN programs p ON p.id = c.program_id
     JOIN panel_members pm ON pm.round_id = r.id
     WHERE pm.juror_id = $1 AND r.state = 'open'
     ORDER BY r.opened_at`,
    [actor.id],
  );
  const rounds = [];
  for (const row of result.rows) {
    const counts = await ballotCounts(row.id, actor.id);
    rounds.push({
      id: row.id,
      name: row.name,
      categoryName: row.category_name,
      ballotDeadlineLabel: row.ballot_deadline === null ? null : dateLabel(row.ballot_deadline, row.time_zone),
      assigned: counts.assigned,
      remaining: counts.submitted ? 0 : counts.assigned - counts.scored,
      ballotSubmitted: counts.submitted,
    });
  }
  return json(200, { rounds });
}

async function showBallot(ctx: Ctx): Promise<Reply> {
  const { round, jurorId } = await panelRound(ctx, ctx.params.id);
  const category = await loadCategory(pool, round.category_id);
  if (category === null) throw notFound();
  const program = await loadProgram(pool, category.program_id);
  if (program === null) throw notFound();

  const entries = await pool.query<{
    entry_id: string;
    entry_number: number;
    title: string;
    summary: string;
    craft: number | null;
    clarity: number | null;
    idea: number | null;
    story: number | null;
  }>(
    `SELECT e.id AS entry_id, e.entry_number, e.title, e.summary,
            s.craft, s.clarity, s.idea, s.story
     FROM assignments a
     JOIN entries e ON e.id = a.entry_id
     LEFT JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
     WHERE a.round_id = $1 AND a.juror_id = $2 AND a.recused_at IS NULL
     ORDER BY e.entry_number`,
    [round.id, jurorId],
  );
  const blind = [];
  for (const entry of entries.rows) {
    const assets = await pool.query<{ id: string; width: number; height: number }>(
      'SELECT id, width, height FROM assets WHERE entry_id = $1 ORDER BY seq',
      [entry.entry_id],
    );
    blind.push({
      entryId: entry.entry_id,
      entryNumber: entry.entry_number,
      title: entry.title,
      summary: entry.summary,
      images: assets.rows.map((asset) => ({
        url: `/api/assets/${asset.id}`,
        width: asset.width,
        height: asset.height,
      })),
      scores:
        entry.craft === null
          ? null
          : { craft: entry.craft, clarity: entry.clarity, idea: entry.idea, story: entry.story },
    });
  }
  const counts = await ballotCounts(round.id, jurorId);
  return json(200, {
    round: {
      id: round.id,
      name: round.name,
      categoryName: category.name,
      ballotDeadlineLabel:
        round.ballot_deadline === null ? null : dateLabel(round.ballot_deadline, program.time_zone),
      ballotDeadlineAt:
        round.ballot_deadline === null
          ? null
          : withOffset(cutoffInstant(round.ballot_deadline, program.time_zone), program.time_zone),
      state: round.state,
    },
    entries: blind,
    assigned: counts.assigned,
    scored: counts.scored,
    remaining: counts.submitted ? 0 : counts.assigned - counts.scored,
    submitted: counts.submitted,
  });
}

async function saveScores(ctx: Ctx): Promise<Reply> {
  const { round, jurorId } = await panelRound(ctx, ctx.params.id);
  const assignment = await pool.query(
    'SELECT 1 FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3 AND recused_at IS NULL',
    [round.id, jurorId, ctx.params.entryId],
  );
  if (assignment.rowCount === 0) throw notFound();
  if (round.state !== 'open') throw roundClosed();
  const member = await pool.query<{ ballot_submitted_at: Date | null }>(
    'SELECT ballot_submitted_at FROM panel_members WHERE round_id = $1 AND juror_id = $2',
    [round.id, jurorId],
  );
  if (member.rows[0].ballot_submitted_at !== null) throw ballotSubmitted();

  const values: Record<string, number> = {};
  const bad: string[] = [];
  for (const field of CRITERIA) {
    const raw = ctx.body[field];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > 10) bad.push(field);
    else values[field] = value;
  }
  if (bad.length > 0) throw badScore(bad);

  await pool.query(
    `INSERT INTO scores (round_id, juror_id, entry_id, craft, clarity, idea, story)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (round_id, juror_id, entry_id)
     DO UPDATE SET craft = $4, clarity = $5, idea = $6, story = $7, updated_at = now()`,
    [round.id, jurorId, ctx.params.entryId, values.craft, values.clarity, values.idea, values.story],
  );
  const counts = await ballotCounts(round.id, jurorId);
  return json(200, {
    scores: { craft: values.craft, clarity: values.clarity, idea: values.idea, story: values.story },
    remaining: counts.assigned - counts.scored,
  });
}

async function submitBallot(ctx: Ctx): Promise<Reply> {
  const { round, jurorId } = await panelRound(ctx, ctx.params.id);
  return withLock(round.id, async () => {
    const fresh = await loadRound(pool, round.id);
    if (fresh === null) throw notFound();
    if (fresh.state !== 'open') throw roundClosed();
    const counts = await ballotCounts(round.id, jurorId);
    if (counts.submitted) {
      return json(200, { submitted: true, counted: counts.assigned, submittedAt: null });
    }
    if (counts.assigned - counts.scored > 0) throw ballotIncomplete(counts.assigned - counts.scored);
    const submittedAt = new Date();
    await pool.query(
      'UPDATE panel_members SET ballot_submitted_at = $3 WHERE round_id = $1 AND juror_id = $2',
      [round.id, jurorId, submittedAt],
    );
    return json(200, {
      submitted: true,
      counted: counts.assigned,
      submittedAt: submittedAt.toISOString(),
    });
  });
}

async function recuse(ctx: Ctx): Promise<Reply> {
  const { round, jurorId } = await panelRound(ctx, ctx.params.id);
  const assignment = await pool.query(
    'SELECT 1 FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3 AND recused_at IS NULL',
    [round.id, jurorId, ctx.params.entryId],
  );
  if (assignment.rowCount === 0) throw notFound();
  if (round.state !== 'open') throw roundClosed();
  const note = text(ctx.body, 'note');
  if (note.length > 300) throw invalid({ note: 'Keep the note to 300 characters or fewer.' });

  await inTransaction(async (db) => {
    await db.query(
      'UPDATE assignments SET recused_at = now(), recuse_note = $4 WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3',
      [round.id, jurorId, ctx.params.entryId, note === '' ? null : note],
    );
    await db.query(
      'INSERT INTO packet_jobs (round_id) VALUES ($1) ON CONFLICT (round_id) DO UPDATE SET updated_at = now()',
      [round.id],
    );
  });
  const counts = await ballotCounts(round.id, jurorId);
  return json(200, { remaining: counts.submitted ? 0 : counts.assigned - counts.scored });
}

async function declareConflict(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'juror');
  const studioId = text(ctx.body, 'studioId');
  const note = text(ctx.body, 'note');
  const studio = await pool.query<{ name: string }>('SELECT name FROM studios WHERE id = $1', [studioId]);
  if (studio.rowCount === 0) throw invalid({ studioId: 'Choose a studio.' });
  if (note.length > 300) throw invalid({ note: 'Keep the note to 300 characters or fewer.' });

  const existing = await pool.query<{ note: string | null; declared_at: Date }>(
    'SELECT note, declared_at FROM conflicts WHERE juror_id = $1 AND studio_id = $2',
    [actor.id, studioId],
  );
  if (existing.rowCount !== 0) {
    return json(200, {
      conflict: {
        studioId,
        studioName: studio.rows[0].name,
        note: existing.rows[0].note,
        declaredAt: existing.rows[0].declared_at.toISOString(),
      },
      removedAssignments: 0,
    });
  }

  const declaredAt = new Date();
  const removed = await inTransaction(async (db) => {
    await db.query('INSERT INTO conflicts (juror_id, studio_id, note, declared_at) VALUES ($1, $2, $3, $4)', [
      actor.id,
      studioId,
      note === '' ? null : note,
      declaredAt,
    ]);
    const deleted = await db.query<{ round_id: string }>(
      `DELETE FROM assignments a
       USING entries e, rounds r
       WHERE a.entry_id = e.id AND r.id = a.round_id
         AND a.juror_id = $1 AND e.studio_id = $2 AND r.state = 'open' AND a.recused_at IS NULL
       RETURNING a.round_id`,
      [actor.id, studioId],
    );
    for (const round of new Set(deleted.rows.map((row) => row.round_id))) {
      await db.query(
        'INSERT INTO packet_jobs (round_id) VALUES ($1) ON CONFLICT (round_id) DO UPDATE SET updated_at = now()',
        [round],
      );
    }
    return deleted.rowCount ?? 0;
  });

  return json(201, {
    conflict: {
      studioId,
      studioName: studio.rows[0].name,
      note: note === '' ? null : note,
      declaredAt: declaredAt.toISOString(),
    },
    removedAssignments: removed,
  });
}

async function listConflicts(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'juror');
  const result = await pool.query<{
    studio_id: string;
    name: string;
    note: string | null;
    declared_at: Date;
  }>(
    `SELECT c.studio_id, s.name, c.note, c.declared_at
     FROM conflicts c JOIN studios s ON s.id = c.studio_id
     WHERE c.juror_id = $1 ORDER BY s.name`,
    [actor.id],
  );
  return json(200, {
    conflicts: result.rows.map((row) => ({
      studioId: row.studio_id,
      studioName: row.name,
      note: row.note,
      declaredAt: row.declared_at.toISOString(),
    })),
  });
}

export const jurorRoutes = [
  route('GET', '/api/juror/rounds', jurorRounds),
  route('GET', '/api/rounds/:id/ballot', showBallot),
  route('PUT', '/api/rounds/:id/scores/:entryId', saveScores),
  route('POST', '/api/rounds/:id/ballot/submit', submitBallot),
  route('POST', '/api/rounds/:id/entries/:entryId/recuse', recuse),
  route('POST', '/api/conflicts', declareConflict),
  route('GET', '/api/conflicts', listConflicts),
];

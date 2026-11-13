import {
  badReason,
  deadlineNotPassed,
  finalNotConfirmed,
  invalidTransition,
  noEntries,
  notFound,
  panelEmpty,
  previousRoundNotConfirmed,
  screeningIncomplete,
  storageUnavailableOnOpen,
} from '../copy';
import {
  cutLabelOf,
  cutSizeOf,
  countedScores,
  entryContext,
  excludedStudios,
  loadCategory,
  loadEntry,
  loadProgram,
  loadRound,
  panelOf,
  pendingEntryState,
  queueEmail,
  rankEntries,
  roundEntryState,
  roundsOf,
  standingsFor,
  writeAudit,
} from '../data';
import { inTransaction, pool, withLock, type Db } from '../db';
import { entriesOpen } from '../domain/fees';
import { computeRoundScores } from '../domain/scoring';
import { requireEntryState, requireRoundState } from '../domain/states';
import { dateLabel, momentLabel, parseDate, toIsoUtc, withOffset } from '../domain/time';
import type { CategoryRow, EntryRow, ProgramRow, RoundRow } from '../domain/types';
import { putObject, StorageUnavailableError } from '../providers/storage';
import { invalid } from '../http/errors';
import { json, requireRole, route, type Ctx, type Reply } from '../http/router';
import { text } from '../http/validate';
import { entryJson, roundJson } from '../view';

interface RoundScene {
  round: RoundRow;
  category: CategoryRow;
  program: ProgramRow;
}

async function roundScene(id: string): Promise<RoundScene> {
  const round = await loadRound(pool, id);
  if (round === null) throw notFound();
  const category = await loadCategory(pool, round.category_id);
  if (category === null) throw notFound();
  const program = await loadProgram(pool, category.program_id);
  if (program === null) throw notFound();
  return { round, category, program };
}

async function directorEntry(entry: EntryRow, now: Date): Promise<Record<string, unknown>> {
  return entryJson(await entryContext(pool, entry, now), true, now);
}

async function categoryEntries(ctx: Ctx): Promise<Reply> {
  const category = await loadCategory(pool, ctx.params.id);
  if (category === null) throw notFound();
  requireRole(ctx, 'director');
  const now = new Date();
  const result = await pool.query<EntryRow>(
    "SELECT * FROM entries WHERE category_id = $1 AND state <> 'draft' ORDER BY entry_number",
    [category.id],
  );
  const entries = [];
  for (const entry of result.rows) entries.push(await directorEntry(entry, now));
  return json(200, { entries });
}

async function requireScreeningWindow(entry: EntryRow): Promise<void> {
  const program = await loadProgram(pool, entry.program_id);
  if (program === null) throw notFound();
  if (entriesOpen(program, new Date())) {
    throw deadlineNotPassed(dateLabel(program.deadline_date, program.time_zone));
  }
}

async function screenEntry(ctx: Ctx): Promise<Reply> {
  const entry = await loadEntry(pool, ctx.params.id);
  if (entry === null) throw notFound();
  const actor = requireRole(ctx, 'director');
  const decision = text(ctx.body, 'decision');
  const reason = text(ctx.body, 'reason');

  if (decision !== 'pass' && decision !== 'disqualify') {
    throw invalid({ decision: 'Choose pass or disqualify.' });
  }
  requireEntryState(entry.state, decision);
  await requireScreeningWindow(entry);
  if (decision === 'disqualify' && (reason.length < 1 || reason.length > 300)) throw badReason();

  const updated = await pool.query<EntryRow>(
    decision === 'pass'
      ? "UPDATE entries SET state = 'screened', disqualify_reason = NULL WHERE id = $1 RETURNING *"
      : "UPDATE entries SET state = 'disqualified', disqualify_reason = $2 WHERE id = $1 RETURNING *",
    decision === 'pass' ? [entry.id] : [entry.id, reason],
  );
  await writeAudit(pool, actor.id, decision === 'pass' ? 'entry.pass' : 'entry.disqualify', 'entry', entry.id, {
    entryNumber: entry.entry_number,
    reason: decision === 'disqualify' ? reason : null,
  });
  return json(200, { entry: await directorEntry(updated.rows[0], new Date()) });
}

async function reinstateEntry(ctx: Ctx): Promise<Reply> {
  const entry = await loadEntry(pool, ctx.params.id);
  if (entry === null) throw notFound();
  const actor = requireRole(ctx, 'director');
  requireEntryState(entry.state, 'reinstate');
  await requireScreeningWindow(entry);
  const updated = await pool.query<EntryRow>(
    "UPDATE entries SET state = 'screened', disqualify_reason = NULL WHERE id = $1 RETURNING *",
    [entry.id],
  );
  await writeAudit(pool, actor.id, 'entry.reinstate', 'entry', entry.id, { entryNumber: entry.entry_number });
  return json(200, { entry: await directorEntry(updated.rows[0], new Date()) });
}

async function showRound(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  requireRole(ctx, 'director');
  return json(200, {
    round: roundJson(scene.round, scene.program),
    panel: await panelOf(pool, scene.round),
  });
}

async function roundEntries(db: Db, round: RoundRow, state: string): Promise<{ id: string; studio_id: string }[]> {
  const result = await db.query<{ id: string; studio_id: string }>(
    'SELECT id, studio_id FROM entries WHERE category_id = $1 AND state = $2 ORDER BY entry_number',
    [round.category_id, state],
  );
  return result.rows;
}

function invitationMail(
  categoryName: string,
  round: RoundRow,
  deadlineLabel: string,
  assigned: number,
): { subject: string; body: string } {
  return {
    subject: `Cutline jury invitation: ${categoryName} — ${round.name}`,
    body: [
      `${categoryName} — ${round.name}`,
      `Ballot deadline: ${deadlineLabel}`,
      `${assigned} entries assigned`,
      'Open your ballot at /jury',
    ].join('\n'),
  };
}

async function addPanelJuror(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  const actor = requireRole(ctx, 'director');
  requireRoundState(scene.round.state, 'add_juror');

  const jurorId = text(ctx.body, 'jurorId');
  const juror = await pool.query<{ id: string; name: string; email: string; studio_id: string | null }>(
    "SELECT id, name, email, studio_id FROM users WHERE id = $1 AND role = 'juror'",
    [jurorId],
  );
  if (juror.rowCount === 0) throw invalid({ jurorId: 'Choose a juror.' });

  const already = await pool.query('SELECT 1 FROM panel_members WHERE round_id = $1 AND juror_id = $2', [
    scene.round.id,
    jurorId,
  ]);
  if (already.rowCount !== 0) {
    return json(200, { panel: await panelOf(pool, scene.round) });
  }

  const excluded = await excludedStudios(pool, jurorId, juror.rows[0].studio_id);
  const entries =
    scene.round.state === 'open'
      ? (await roundEntries(pool, scene.round, roundEntryState(scene.round.kind))).filter(
          (entry) => !excluded.has(entry.studio_id),
        )
      : [];
  const deadlineLabel =
    scene.round.ballot_deadline === null
      ? null
      : dateLabel(scene.round.ballot_deadline, scene.program.time_zone);

  await inTransaction(async (db) => {
    await db.query('INSERT INTO panel_members (round_id, juror_id) VALUES ($1, $2)', [scene.round.id, jurorId]);
    for (const entry of entries) {
      await db.query('INSERT INTO assignments (round_id, juror_id, entry_id) VALUES ($1, $2, $3)', [
        scene.round.id,
        jurorId,
        entry.id,
      ]);
    }
    if (scene.round.state === 'open' && deadlineLabel !== null) {
      const mail = invitationMail(scene.category.name, scene.round, deadlineLabel, entries.length);
      await queueEmail(db, `invite:${scene.round.id}:${jurorId}`, juror.rows[0].email, mail.subject, mail.body);
      await db.query('INSERT INTO packet_jobs (round_id) VALUES ($1) ON CONFLICT (round_id) DO UPDATE SET updated_at = now()', [
        scene.round.id,
      ]);
    }
    await writeAudit(db, actor.id, 'panel.add', 'round', scene.round.id, { jurorId });
  });
  return json(201, { panel: await panelOf(pool, scene.round) });
}

export interface PacketEntry {
  entryNumber: number;
  title: string;
  summary: string;
  assetIds: string[];
}

export async function buildPacket(db: Db, round: RoundRow, categoryName: string, deadlineLabel: string | null, state: string) {
  const entries = await db.query<{ id: string; entry_number: number; title: string; summary: string }>(
    'SELECT id, entry_number, title, summary FROM entries WHERE category_id = $1 AND state = $2 ORDER BY entry_number',
    [round.category_id, state],
  );
  const packetEntries: PacketEntry[] = [];
  for (const entry of entries.rows) {
    const assets = await db.query<{ id: string }>('SELECT id FROM assets WHERE entry_id = $1 ORDER BY seq', [
      entry.id,
    ]);
    packetEntries.push({
      entryNumber: entry.entry_number,
      title: entry.title,
      summary: entry.summary,
      assetIds: assets.rows.map((row) => row.id),
    });
  }
  return {
    roundId: round.id,
    roundName: round.name,
    categoryName,
    ballotDeadlineLabel: deadlineLabel,
    entries: packetEntries,
  };
}

export function packetKey(roundId: string): string {
  return `rounds/${roundId}/jury-packet.json`;
}

async function openRound(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  const actor = requireRole(ctx, 'director');
  const { round, category, program } = scene;

  requireRoundState(round.state, 'open');
  if (round.kind === 'round_1') {
    if (entriesOpen(program, new Date())) {
      throw deadlineNotPassed(dateLabel(program.deadline_date, program.time_zone));
    }
    const unscreened = await pool.query(
      "SELECT 1 FROM entries WHERE category_id = $1 AND state = 'submitted' LIMIT 1",
      [category.id],
    );
    if (unscreened.rowCount !== 0) throw screeningIncomplete();
  } else {
    const rounds = await roundsOf(pool, category.id);
    const first = rounds.find((candidate) => candidate.kind === 'round_1');
    if (first === undefined || first.state !== 'normalised') throw previousRoundNotConfirmed();
  }
  const panel = await pool.query<{ juror_id: string; email: string; studio_id: string | null }>(
    'SELECT pm.juror_id, u.email, u.studio_id FROM panel_members pm JOIN users u ON u.id = pm.juror_id WHERE pm.round_id = $1',
    [round.id],
  );
  if (panel.rowCount === 0) throw panelEmpty();
  const pending = await roundEntries(pool, round, pendingEntryState(round.kind));
  if (pending.length === 0) throw noEntries();

  const ballotDeadline = text(ctx.body, 'ballotDeadline');
  if (parseDate(ballotDeadline) === null) throw invalid({ ballotDeadline: 'Give a date as YYYY-MM-DD.' });
  const deadlineLabel = dateLabel(ballotDeadline, program.time_zone);

  const packet = await buildPacket(pool, round, category.name, deadlineLabel, pendingEntryState(round.kind));
  try {
    await putObject(packetKey(round.id), Buffer.from(JSON.stringify(packet)), 'application/json');
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailableOnOpen();
    throw error;
  }

  const opened = await inTransaction(async (db) => {
    const moved = await db.query<RoundRow>(
      "UPDATE rounds SET state = 'open', ballot_deadline = $2, opened_at = now() WHERE id = $1 AND state = 'scheduled' RETURNING *",
      [round.id, ballotDeadline],
    );
    if (moved.rowCount === 0) throw invalidTransition(round.state, 'open');
    await db.query('UPDATE entries SET state = $3 WHERE category_id = $1 AND state = $2', [
      category.id,
      pendingEntryState(round.kind),
      roundEntryState(round.kind),
    ]);
    for (const member of panel.rows) {
      const excluded = await excludedStudios(db, member.juror_id, member.studio_id);
      const mine = pending.filter((entry) => !excluded.has(entry.studio_id));
      for (const entry of mine) {
        await db.query('INSERT INTO assignments (round_id, juror_id, entry_id) VALUES ($1, $2, $3)', [
          round.id,
          member.juror_id,
          entry.id,
        ]);
      }
      const mail = invitationMail(category.name, round, deadlineLabel, mine.length);
      await queueEmail(db, `invite:${round.id}:${member.juror_id}`, member.email, mail.subject, mail.body);
    }
    await writeAudit(db, actor.id, 'round.open', 'round', round.id, { ballotDeadline });
    return moved.rows[0];
  });
  return json(200, { round: roundJson(opened, program) });
}

async function closeRound(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  const actor = requireRole(ctx, 'director');
  const { round, category, program } = scene;
  requireRoundState(round.state, 'close');

  return withLock(round.id, async () => {
    const fresh = await loadRound(pool, round.id);
    if (fresh === null) throw notFound();
    requireRoundState(fresh.state, 'close');

    const entries = await pool.query<{
      id: string;
      entry_number: number;
      title: string;
      submitted_at: Date | null;
      award: string | null;
    }>(
      'SELECT id, entry_number, title, submitted_at, award FROM entries WHERE category_id = $1 AND state = $2',
      [category.id, roundEntryState(round.kind)],
    );
    const computed = computeRoundScores(await countedScores(pool, round.id));
    const scores = new Map(
      computed.map((item) => [
        item.entryId,
        { score: item.score, ideaMean: item.ideaMean, ballotsCounted: item.ballotsCounted },
      ]),
    );
    const cut = cutSizeOf(category, round.kind);
    const rows = rankEntries(entries.rows, scores, category.name, cut);

    const closed = await inTransaction(async (db) => {
      const moved = await db.query<RoundRow>(
        "UPDATE rounds SET state = 'closed', closed_at = now() WHERE id = $1 AND state = 'open' RETURNING *",
        [round.id],
      );
      if (moved.rowCount === 0) throw invalidTransition(fresh.state, 'close');
      for (const row of rows) {
        await db.query(
          `INSERT INTO round_results (round_id, entry_id, score, idea_mean, ballots_counted, rank, cut)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [round.id, row.entryId, row.score, row.ideaMean, row.ballotsCounted, row.rank, row.cut],
        );
      }
      await writeAudit(db, actor.id, 'round.close', 'round', round.id, { entries: rows.length });
      return moved.rows[0];
    });

    return json(200, {
      round: roundJson(closed, program),
      standings: { provisional: false, cut, cutLabel: cutLabelOf(round.kind), rows },
    });
  });
}

async function confirmRound(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  const actor = requireRole(ctx, 'director');
  const { round, category, program } = scene;
  requireRoundState(round.state, 'confirm');

  const results = await pool.query<{ entry_id: string; rank: number; cut: string }>(
    'SELECT entry_id, rank, cut FROM round_results WHERE round_id = $1 ORDER BY rank',
    [round.id],
  );
  const outcomes: { entryNumber: number; state: string }[] = [];

  const confirmed = await inTransaction(async (db) => {
    const moved = await db.query<RoundRow>(
      "UPDATE rounds SET state = 'normalised' WHERE id = $1 AND state = 'closed' RETURNING *",
      [round.id],
    );
    if (moved.rowCount === 0) throw invalidTransition(round.state, 'confirm');
    for (const row of results.rows) {
      const state =
        round.kind === 'round_1'
          ? row.cut === 'above'
            ? 'shortlisted'
            : 'eliminated'
          : row.rank === 1
            ? 'winner'
            : row.rank <= category.finalist_count
              ? 'finalist'
              : 'honourable_mention';
      const award = round.kind === 'round_1' ? null : state;
      const updated = await db.query<{ entry_number: number }>(
        'UPDATE entries SET state = $2, award = $3 WHERE id = $1 RETURNING entry_number',
        [row.entry_id, state, award],
      );
      outcomes.push({ entryNumber: updated.rows[0].entry_number, state });
    }
    await writeAudit(db, actor.id, 'round.confirm', 'round', round.id, { entries: results.rowCount });
    return moved.rows[0];
  });
  return json(200, { round: roundJson(confirmed, program), outcomes });
}

async function roundStandings(ctx: Ctx): Promise<Reply> {
  const scene = await roundScene(ctx.params.id);
  requireRole(ctx, 'director');
  return json(200, await standingsFor(pool, scene.round, scene.category));
}

function parseOffsetMoment(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function publishCategory(ctx: Ctx): Promise<Reply> {
  const category = await loadCategory(pool, ctx.params.id);
  if (category === null) throw notFound();
  const actor = requireRole(ctx, 'director');
  const program = await loadProgram(pool, category.program_id);
  if (program === null) throw notFound();

  if (category.published) throw invalidTransition('published', 'publish');
  const rounds = await roundsOf(pool, category.id);
  const final = rounds.find((round) => round.kind === 'final');
  if (final === undefined || final.state !== 'normalised') throw finalNotConfirmed();

  const embargo = parseOffsetMoment(text(ctx.body, 'embargoAt'));
  if (embargo === null) throw invalid({ embargoAt: 'Give a time as YYYY-MM-DDTHH:MM with an offset.' });

  await inTransaction(async (db) => {
    await db.query('UPDATE categories SET published = true, embargo_at = $2 WHERE id = $1', [
      category.id,
      embargo,
    ]);
    await db.query("UPDATE rounds SET state = 'published' WHERE category_id = $1", [category.id]);
    await db.query(
      "UPDATE entries SET state = 'published' WHERE category_id = $1 AND state IN ('winner','finalist','honourable_mention')",
      [category.id],
    );
    await writeAudit(db, actor.id, 'category.publish', 'category', category.id, {
      embargoAt: embargo.toISOString(),
    });
  });

  return json(200, {
    category: {
      id: category.id,
      name: category.name,
      embargoAt: withOffset(embargo, program.time_zone),
      embargoLabel: momentLabel(embargo, program.time_zone),
      state: 'published',
    },
  });
}

async function auditTrail(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, 'director');
  const result = await pool.query<{
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    at: Date;
    detail: Record<string, unknown>;
  }>('SELECT id, action, target_type, target_id, at, detail FROM audit_events ORDER BY seq DESC LIMIT 200');
  return json(200, {
    events: result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      at: toIsoUtc(row.at),
      detail: row.detail,
    })),
  });
}

export const directorRoutes = [
  route('GET', '/api/categories/:id/entries', categoryEntries),
  route('POST', '/api/entries/:id/screen', screenEntry),
  route('POST', '/api/entries/:id/reinstate', reinstateEntry),
  route('GET', '/api/rounds/:id', showRound),
  route('POST', '/api/rounds/:id/jurors', addPanelJuror),
  route('POST', '/api/rounds/:id/open', openRound),
  route('POST', '/api/rounds/:id/close', closeRound),
  route('POST', '/api/rounds/:id/confirm', confirmRound),
  route('GET', '/api/rounds/:id/standings', roundStandings),
  route('POST', '/api/categories/:id/publish', publishCategory),
  route('GET', '/api/audit', auditTrail),
];

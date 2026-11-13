import { newId, type Db } from './db';
import { notFound } from './copy';
import { compareForRank, cutFor } from './domain/ranking';
import { computeRoundScores, formatScore, type CountedScore } from './domain/scoring';
import { cutoffInstant } from './domain/time';
import type {
  AssetRow,
  CategoryRow,
  EntryRow,
  ProgramRow,
  RoundKind,
  RoundRow,
} from './domain/types';
import type { EntryContext } from './view';

export async function loadProgram(db: Db, id: string): Promise<ProgramRow | null> {
  const result = await db.query<ProgramRow>('SELECT * FROM programs WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function loadCategory(db: Db, id: string): Promise<CategoryRow | null> {
  const result = await db.query<CategoryRow>('SELECT * FROM categories WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function loadRound(db: Db, id: string): Promise<RoundRow | null> {
  const result = await db.query<RoundRow>('SELECT * FROM rounds WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function roundsOf(db: Db, categoryId: string): Promise<RoundRow[]> {
  const result = await db.query<RoundRow>(
    "SELECT * FROM rounds WHERE category_id = $1 ORDER BY CASE kind WHEN 'round_1' THEN 0 ELSE 1 END",
    [categoryId],
  );
  return result.rows;
}

export async function categoriesOf(db: Db, programId: string): Promise<CategoryRow[]> {
  const result = await db.query<CategoryRow>(
    'SELECT * FROM categories WHERE program_id = $1 ORDER BY seq',
    [programId],
  );
  return result.rows;
}

export async function assetsOf(db: Db, entryId: string): Promise<AssetRow[]> {
  const result = await db.query<AssetRow>('SELECT * FROM assets WHERE entry_id = $1 ORDER BY seq', [entryId]);
  return result.rows;
}

export function embargoPassed(category: CategoryRow, now: Date): boolean {
  return category.published && category.embargo_at !== null && category.embargo_at.getTime() <= now.getTime();
}

/** The program accepting entries whose deadline comes soonest; ties go to the oldest program. */
export async function openProgram(db: Db, now: Date): Promise<ProgramRow | null> {
  const result = await db.query<ProgramRow>('SELECT * FROM programs ORDER BY seq');
  const open = result.rows
    .map((program) => ({ program, at: cutoffInstant(program.deadline_date, program.time_zone).getTime() }))
    .filter((candidate) => candidate.at > now.getTime())
    .sort((a, b) => a.at - b.at);
  return open.length === 0 ? null : open[0].program;
}

export async function loadEntry(db: Db, id: string): Promise<EntryRow | null> {
  const result = await db.query<EntryRow>('SELECT * FROM entries WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function entryContext(db: Db, entry: EntryRow, now: Date): Promise<EntryContext> {
  const [program, category, assets, studio, results] = await Promise.all([
    loadProgram(db, entry.program_id),
    loadCategory(db, entry.category_id),
    assetsOf(db, entry.id),
    db.query<{ name: string; email: string }>('SELECT name, email FROM studios WHERE id = $1', [entry.studio_id]),
    db.query<{ kind: RoundKind; score: string | null }>(
      `SELECT r.kind, rr.score FROM round_results rr
       JOIN rounds r ON r.id = rr.round_id
       WHERE rr.entry_id = $1`,
      [entry.id],
    ),
  ]);
  if (program === null || category === null) throw notFound();
  const scoreOf = (kind: RoundKind): string | null => {
    const row = results.rows.find((r) => r.kind === kind);
    return row === undefined || row.score === null ? null : Number(row.score).toFixed(2);
  };
  return {
    entry,
    assets,
    program,
    categoryName: category.name,
    embargoPassed: embargoPassed(category, now),
    roundOneScore: scoreOf('round_1'),
    finalScore: scoreOf('final'),
    studioName: studio.rows[0].name,
    studioEmail: studio.rows[0].email,
  };
}

export async function writeAudit(
  db: Db,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'INSERT INTO audit_events (id, actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5, $6)',
    [newId('aud'), actorId, action, targetType, targetId, JSON.stringify(detail)],
  );
}

export async function queueEmail(
  db: Db,
  dedupeKey: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  await db.query(
    `INSERT INTO emails (id, dedupe_key, to_addr, subject, body)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING`,
    [newId('mail'), dedupeKey, to, subject, body],
  );
}

export async function recordSentEmail(db: Db, dedupeKey: string, to: string, subject: string, body: string): Promise<void> {
  await db.query(
    `INSERT INTO emails (id, dedupe_key, to_addr, subject, body, sent_at)
     VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (dedupe_key) DO NOTHING`,
    [newId('mail'), dedupeKey, to, subject, body],
  );
}

export function roundEntryState(kind: RoundKind): string {
  return kind === 'round_1' ? 'round_1' : 'final_round';
}

export function pendingEntryState(kind: RoundKind): string {
  return kind === 'round_1' ? 'screened' : 'shortlisted';
}

export interface PanelRow {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

interface PanelMember {
  juror_id: string;
  name: string;
  home_studio: string | null;
  ballot_submitted: boolean;
}

export async function excludedStudios(db: Db, jurorId: string, homeStudio: string | null): Promise<Set<string>> {
  const conflicts = await db.query<{ studio_id: string }>('SELECT studio_id FROM conflicts WHERE juror_id = $1', [
    jurorId,
  ]);
  const excluded = new Set(conflicts.rows.map((row) => row.studio_id));
  if (homeStudio !== null) excluded.add(homeStudio);
  return excluded;
}

export async function panelOf(db: Db, round: RoundRow): Promise<PanelRow[]> {
  const members = await db.query<PanelMember>(
    `SELECT pm.juror_id, u.name, u.studio_id AS home_studio,
            (pm.ballot_submitted_at IS NOT NULL) AS ballot_submitted
     FROM panel_members pm JOIN users u ON u.id = pm.juror_id
     WHERE pm.round_id = $1 ORDER BY pm.created_at, u.name`,
    [round.id],
  );
  if (round.state === 'scheduled') {
    const candidates = await db.query<{ id: string; studio_id: string }>(
      'SELECT id, studio_id FROM entries WHERE category_id = $1 AND state = $2',
      [round.category_id, pendingEntryState(round.kind)],
    );
    const rows: PanelRow[] = [];
    for (const member of members.rows) {
      const excluded = await excludedStudios(db, member.juror_id, member.home_studio);
      const assigned = candidates.rows.filter((entry) => !excluded.has(entry.studio_id)).length;
      rows.push({
        jurorId: member.juror_id,
        name: member.name,
        assigned,
        scored: 0,
        remaining: assigned,
        ballotSubmitted: false,
      });
    }
    return rows;
  }
  const counts = await db.query<{ juror_id: string; assigned: string; scored: string }>(
    `SELECT a.juror_id, count(*) AS assigned,
            count(s.entry_id) AS scored
     FROM assignments a
     LEFT JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
     WHERE a.round_id = $1 AND a.recused_at IS NULL
     GROUP BY a.juror_id`,
    [round.id],
  );
  return members.rows.map((member) => {
    const row = counts.rows.find((c) => c.juror_id === member.juror_id);
    const assigned = row === undefined ? 0 : Number(row.assigned);
    const scored = row === undefined ? 0 : Number(row.scored);
    return {
      jurorId: member.juror_id,
      name: member.name,
      assigned,
      scored,
      remaining: member.ballot_submitted ? 0 : assigned - scored,
      ballotSubmitted: member.ballot_submitted,
    };
  });
}

export async function countedScores(db: Db, roundId: string): Promise<CountedScore[]> {
  const result = await db.query<{
    juror_id: string;
    entry_id: string;
    craft: number;
    clarity: number;
    idea: number;
    story: number;
  }>(
    `SELECT s.juror_id, s.entry_id, s.craft, s.clarity, s.idea, s.story
     FROM scores s
     JOIN assignments a ON a.round_id = s.round_id AND a.juror_id = s.juror_id
                       AND a.entry_id = s.entry_id AND a.recused_at IS NULL
     JOIN panel_members pm ON pm.round_id = s.round_id AND pm.juror_id = s.juror_id
                          AND pm.ballot_submitted_at IS NOT NULL
     WHERE s.round_id = $1`,
    [roundId],
  );
  return result.rows.map((row) => ({
    jurorId: row.juror_id,
    entryId: row.entry_id,
    craft: row.craft,
    clarity: row.clarity,
    idea: row.idea,
    story: row.story,
  }));
}

export interface StandingRow {
  rank: number;
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: string | null;
  ideaMean: number | null;
  ballotsCounted: number;
  cut: 'above' | 'below';
  award: string | null;
}

export interface Standings {
  provisional: boolean;
  cut: number;
  cutLabel: string;
  rows: StandingRow[];
}

export function cutSizeOf(category: CategoryRow, kind: RoundKind): number {
  return kind === 'round_1' ? category.shortlist_size : category.finalist_count;
}

export function cutLabelOf(kind: RoundKind): string {
  return kind === 'round_1' ? 'Shortlist cut' : 'Finalist cut';
}

interface RankableEntry {
  id: string;
  entry_number: number;
  title: string;
  submitted_at: Date | null;
  award: string | null;
}

export function rankEntries(
  entries: readonly RankableEntry[],
  scores: Map<string, { score: number | null; ideaMean: number | null; ballotsCounted: number }>,
  categoryName: string,
  cut: number,
): StandingRow[] {
  const sorted = [...entries].sort((a, b) =>
    compareForRank(
      {
        entryId: a.id,
        entryNumber: a.entry_number,
        submittedAt: a.submitted_at,
        score: scores.get(a.id)?.score ?? null,
        ideaMean: scores.get(a.id)?.ideaMean ?? null,
      },
      {
        entryId: b.id,
        entryNumber: b.entry_number,
        submittedAt: b.submitted_at,
        score: scores.get(b.id)?.score ?? null,
        ideaMean: scores.get(b.id)?.ideaMean ?? null,
      },
    ),
  );
  return sorted.map((entry, index) => {
    const found = scores.get(entry.id);
    return {
      rank: index + 1,
      entryId: entry.id,
      entryNumber: entry.entry_number,
      title: entry.title,
      categoryName,
      score: formatScore(found?.score ?? null),
      ideaMean: found?.ideaMean ?? null,
      ballotsCounted: found?.ballotsCounted ?? 0,
      cut: cutFor(index + 1, cut),
      award: entry.award,
    };
  });
}

export async function provisionalStandings(
  db: Db,
  round: RoundRow,
  category: CategoryRow,
): Promise<Standings> {
  const entries = await db.query<RankableEntry>(
    'SELECT id, entry_number, title, submitted_at, award FROM entries WHERE category_id = $1 AND state = $2',
    [round.category_id, roundEntryState(round.kind)],
  );
  const computed = computeRoundScores(await countedScores(db, round.id));
  const scores = new Map(
    computed.map((item) => [
      item.entryId,
      { score: item.score, ideaMean: item.ideaMean, ballotsCounted: item.ballotsCounted },
    ]),
  );
  const cut = cutSizeOf(category, round.kind);
  return {
    provisional: true,
    cut,
    cutLabel: cutLabelOf(round.kind),
    rows: rankEntries(entries.rows, scores, category.name, cut),
  };
}

export async function storedStandings(db: Db, round: RoundRow, category: CategoryRow): Promise<Standings> {
  const result = await db.query<{
    rank: number;
    entry_id: string;
    entry_number: number;
    title: string;
    score: string | null;
    idea_mean: string | null;
    ballots_counted: number;
    cut: 'above' | 'below';
    award: string | null;
  }>(
    `SELECT rr.rank, rr.entry_id, e.entry_number, e.title, rr.score, rr.idea_mean,
            rr.ballots_counted, rr.cut, e.award
     FROM round_results rr JOIN entries e ON e.id = rr.entry_id
     WHERE rr.round_id = $1 ORDER BY rr.rank`,
    [round.id],
  );
  const awarded = round.kind === 'final' && (round.state === 'normalised' || round.state === 'published');
  return {
    provisional: false,
    cut: cutSizeOf(category, round.kind),
    cutLabel: cutLabelOf(round.kind),
    rows: result.rows.map((row) => ({
      rank: row.rank,
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      title: row.title,
      categoryName: category.name,
      score: row.score === null ? null : Number(row.score).toFixed(2),
      ideaMean: row.idea_mean === null ? null : Number(row.idea_mean),
      ballotsCounted: row.ballots_counted,
      cut: row.cut,
      award: awarded ? row.award : null,
    })),
  };
}

export async function standingsFor(db: Db, round: RoundRow, category: CategoryRow): Promise<Standings> {
  if (round.state === 'scheduled') {
    return {
      provisional: true,
      cut: cutSizeOf(category, round.kind),
      cutLabel: cutLabelOf(round.kind),
      rows: [],
    };
  }
  if (round.state === 'open') return provisionalStandings(db, round, category);
  return storedStandings(db, round, category);
}

export async function studioNameOf(db: Db, studioId: string | null): Promise<string | null> {
  if (studioId === null) return null;
  const result = await db.query<{ name: string }>('SELECT name FROM studios WHERE id = $1', [studioId]);
  return result.rows[0]?.name ?? null;
}

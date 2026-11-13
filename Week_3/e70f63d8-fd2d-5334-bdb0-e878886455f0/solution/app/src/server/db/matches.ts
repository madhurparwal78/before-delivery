import type { MatchStatus, TeamRef } from '../../shared/wire.js';
import { config } from '../config.js';
import { notFound } from '../http/errors.js';
import type { InningsRecord, MatchSpec, MatchView } from '../laws/match.js';
import { replayMatch, summarisedView } from '../laws/match.js';
import type { PresentContext } from '../laws/present.js';
import type { MatchFacts, Summary } from '../laws/standings.js';
import { factsOf, summaryFacts } from '../laws/standings.js';
import type { LogEntry, Player, Side } from '../laws/types.js';
import type { Db, Row } from './pool.js';

export interface MatchRow extends Row {
  id: string;
  organiser_id: string;
  home_team_id: string;
  away_team_id: string;
  batting_first_team_id: string;
  tournament_id: string | null;
  tournament_name: string | null;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  viewer_link: boolean;
  viewer_code: string | null;
  played_on: string | null;
  summary: Summary | null;
  home_name: string;
  home_logo: string | null;
  home_uploads: number;
  away_name: string;
  away_logo: string | null;
  away_uploads: number;
  created_at: Date;
}

export interface Bundle {
  row: MatchRow;
  spec: MatchSpec;
  records: InningsRecord[];
  inningsIds: string[];
  view: MatchView;
  facts: MatchFacts | null;
  playedOn: string | null;
  ctx: PresentContext;
}

const dayIn = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

export const logoUrl = (teamId: string, key: string | null, uploads: number): string | null =>
  key === null ? null : `/api/teams/${teamId}/logo?v=${uploads}`;

export const MATCH_SELECT = `
  SELECT m.*, tr.name AS tournament_name, h.name AS home_name, h.logo_key AS home_logo, h.logo_uploads AS home_uploads,
         a.name AS away_name, a.logo_key AS away_logo, a.logo_uploads AS away_uploads
  FROM matches m
  JOIN teams h ON h.id = m.home_team_id
  JOIN teams a ON a.id = m.away_team_id
  LEFT JOIN tournaments tr ON tr.id = m.tournament_id`;

interface XiRow extends Row { team_id: string; id: string; name: string; short_name: string }
interface InningsRow extends Row { id: string; striker_id: string; non_striker_id: string }
interface LogRow extends Row { innings_id: string; entry: LogEntry; recorded_at: Date }

/** Everything the laws need about one match: its row, XIs, innings logs, the replayed view and the figures derived from it. */
export const bundleOf = async (db: Db, row: MatchRow): Promise<Bundle> => {
  const xiRows = await db.query<XiRow>(
    `SELECT x.team_id, p.id, p.name, p.short_name FROM match_xi x JOIN players p ON p.id = x.player_id
     WHERE x.match_id = $1 ORDER BY x.position`, [row.id]);
  const side = (id: string, name: string): Side => ({
    id, name,
    xi: xiRows.filter((candidate) => candidate.team_id === id).map((candidate): Player => ({ id: candidate.id, name: candidate.name, shortName: candidate.short_name })),
  });
  const home = side(row.home_team_id, row.home_name);
  const away = side(row.away_team_id, row.away_name);
  const spec: MatchSpec = {
    home, away, overs: row.overs, playersPerSide: row.players_per_side, superOver: row.super_over,
    superOverMax: config.superOverMax, battingFirst: row.batting_first_team_id,
  };
  const inningsRows = await db.query<InningsRow>(
    'SELECT id, striker_id, non_striker_id FROM innings WHERE match_id = $1 ORDER BY ordinal', [row.id]);
  const logRows = inningsRows.length === 0 ? [] : await db.query<LogRow>(
    'SELECT innings_id, entry, recorded_at FROM ball_log WHERE innings_id = ANY($1) ORDER BY innings_id, position',
    [inningsRows.map((innings) => innings.id)]);
  const records: InningsRecord[] = inningsRows.map((innings) => ({
    striker: innings.striker_id, nonStriker: innings.non_striker_id,
    log: logRows.filter((entry) => entry.innings_id === innings.id).map((entry) => entry.entry),
  }));
  const firstDelivery = logRows.filter((entry) => entry.entry.kind === 'delivery').map((entry) => entry.recorded_at.getTime());
  const derivedDay = firstDelivery.length === 0 ? null : dayIn(new Date(Math.min(...firstDelivery)));
  const playedOn = row.played_on ?? derivedDay;
  let view: MatchView;
  let facts: MatchFacts | null;
  if (row.summary) {
    const summarised = summaryFacts(row.summary, home, away, row.batting_first_team_id, row.overs, row.players_per_side);
    view = summarisedView(spec, { text: summarised.result, winner: summarised.facts.winner });
    facts = summarised.facts;
  } else {
    view = replayMatch(spec, records);
    facts = factsOf(view);
  }
  const refOf = (id: string, name: string, key: string | null, uploads: number): TeamRef => ({ id, name, logo_url: logoUrl(id, key, uploads) });
  return {
    row, spec, records, inningsIds: inningsRows.map((innings) => innings.id), view, facts, playedOn,
    ctx: {
      matchId: row.id, playedOn,
      home: refOf(row.home_team_id, row.home_name, row.home_logo, row.home_uploads),
      away: refOf(row.away_team_id, row.away_name, row.away_logo, row.away_uploads),
    },
  };
};

/** A match as a bundle, locked for the transaction when asked; 404 when it does not exist. */
export const loadMatch = async (db: Db, id: string, lock = false): Promise<Bundle> => {
  const rows = await db.query<MatchRow>(`${MATCH_SELECT} WHERE m.id = $1 ${lock ? 'FOR UPDATE OF m' : ''}`, [id]);
  if (rows.length === 0) throw notFound();
  return bundleOf(db, rows[0]);
};

export const finished = (status: MatchStatus): boolean => status === 'result' || status === 'tied';

const sameEntry = (a: LogEntry | undefined, b: LogEntry | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Writes the innings records of a match: new innings and entries are inserted, changed entries updated, dropped ones deleted. */
export const saveRecords = async (db: Db, bundle: Bundle, records: InningsRecord[], at: Date): Promise<void> => {
  for (let index = records.length; index < bundle.records.length; index += 1) {
    await db.query('DELETE FROM innings WHERE id = $1', [bundle.inningsIds[index]]);
  }
  for (const [index, record] of records.entries()) {
    const old = bundle.records[index];
    const inningsId = old ? bundle.inningsIds[index] : (await db.query<{ id: string }>(
      'INSERT INTO innings (match_id, ordinal, striker_id, non_striker_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [bundle.row.id, index + 1, record.striker, record.nonStriker]))[0].id;
    const oldLog = old?.log ?? [];
    for (const [position, entry] of record.log.entries()) {
      if (position >= oldLog.length) {
        await db.query('INSERT INTO ball_log (innings_id, position, entry, recorded_at) VALUES ($1, $2, $3, $4)',
          [inningsId, position, JSON.stringify(entry), at]);
      } else if (!sameEntry(oldLog[position], entry)) {
        await db.query('UPDATE ball_log SET entry = $3 WHERE innings_id = $1 AND position = $2', [inningsId, position, JSON.stringify(entry)]);
      }
    }
    if (oldLog.length > record.log.length) {
      await db.query('DELETE FROM ball_log WHERE innings_id = $1 AND position >= $2', [inningsId, record.log.length]);
    }
  }
};

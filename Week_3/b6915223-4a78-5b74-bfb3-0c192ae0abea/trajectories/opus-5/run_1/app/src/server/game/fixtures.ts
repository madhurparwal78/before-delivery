import { transaction } from '../db.ts';
import type { CurrentGameweek } from '../../shared/types.ts';
import { broadcast } from '../services/realtime.ts';
import { CLUB_CODES } from './catalogue.ts';
import {
  currentGameweekView,
  deadlineFor,
  effectiveStatus,
  gameweekByNumber,
} from './gameweeks.ts';
import { conflict, validation } from '../http/errors.ts';

const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface FixtureInput {
  home: string;
  away: string;
  kickoff: Date;
}

export const parseFixtures = (value: unknown): FixtureInput[] => {
  const fields: Record<string, string> = {};
  const raw = Array.isArray(value) ? value : [];
  if (raw.length !== 5) fields.fixtures = 'Publish exactly 5 fixtures.';

  const parsed: FixtureInput[] = [];
  const seen: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const fixture = entry as { home?: unknown; away?: unknown; kickoff?: unknown };
    const home = typeof fixture.home === 'string' ? fixture.home : '';
    const away = typeof fixture.away === 'string' ? fixture.away : '';
    if (!CLUB_CODES.includes(home)) fields[`home_${index + 1}`] = 'Choose a club.';
    if (!CLUB_CODES.includes(away)) fields[`away_${index + 1}`] = 'Choose a club.';
    if (home === away && home !== '') fields[`away_${index + 1}`] = 'Choose two different clubs.';
    if (typeof fixture.kickoff !== 'string' || !OFFSET_ISO.test(fixture.kickoff)) {
      fields[`kickoff_${index + 1}`] = 'Give a kickoff time.';
      continue;
    }
    const kickoff = new Date(fixture.kickoff);
    if (Number.isNaN(kickoff.getTime())) {
      fields[`kickoff_${index + 1}`] = 'Give a kickoff time.';
      continue;
    }
    seen.push(home, away);
    parsed.push({ home, away, kickoff });
  }
  if (
    Object.keys(fields).length === 0 &&
    (seen.length !== 10 || new Set(seen).size !== 10)
  ) {
    fields.fixtures = 'Each club plays exactly once.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return parsed;
};

export const publishFixtures = async (
  number: number,
  fixtures: FixtureInput[],
): Promise<CurrentGameweek> => {
  const gameweek = (await gameweekByNumber(number))!;
  if (effectiveStatus(gameweek, new Date()) !== 'open') {
    throw conflict('gameweek_not_open', `Gameweek ${number} is not open.`);
  }

  const firstKickoff = fixtures.reduce(
    (earliest, fixture) => (fixture.kickoff < earliest ? fixture.kickoff : earliest),
    fixtures[0]!.kickoff,
  );
  const deadline = deadlineFor(firstKickoff);
  if (deadline.getTime() <= Date.now()) {
    throw validation({ fixtures: 'The deadline must be in the future.' });
  }

  await transaction(async (client) => {
    await client.query('delete from fixtures where gameweek = $1', [number]);
    for (const fixture of fixtures) {
      await client.query(
        'insert into fixtures (id, gameweek, home, away, kickoff) values ($1, $2, $3, $4, $5)',
        [
          `gw${String(number).padStart(2, '0')}-${fixture.home}-${fixture.away}`,
          number,
          fixture.home,
          fixture.away,
          fixture.kickoff.toISOString(),
        ],
      );
    }
    await client.query(
      'update gameweeks set deadline = $2, first_kickoff = $3 where number = $1',
      [number, deadline.toISOString(), firstKickoff.toISOString()],
    );
  });

  const view = await currentGameweekView();
  broadcast({ type: 'gameweek', gameweek: view });
  return view;
};

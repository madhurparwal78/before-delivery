import { RULESET } from '../../shared/constants.js';
import { requireStore } from '../app.js';
import { computeBoard } from '../rankings.js';
import {
  localTimeOf,
  normalizeInstant,
  parseInstant,
  previousSeasonDay,
  seasonDayOf,
  selectDailyDigest,
} from '../season.js';
import { Problems } from '../validation.js';
import type { ApiResponse, RequestContext } from '../http.js';

function streakFrom(days: Set<string>, seasonDay: string): number {
  let anchor = days.has(seasonDay) ? seasonDay : previousSeasonDay(seasonDay);
  if (!days.has(anchor)) return 0;
  let streak = 0;
  while (days.has(anchor)) {
    streak += 1;
    anchor = previousSeasonDay(anchor);
  }
  return streak;
}

export async function readSeason(request: RequestContext): Promise<ApiResponse> {
  const problems = new Problems();
  const at = request.query.get('at');
  let instant = Date.now();
  if (at !== null) {
    const parsed = parseInstant(at);
    if (parsed === null) problems.add('types', 'at');
    else instant = parsed;
  }
  problems.flush();

  const store = await requireStore(request.app);
  const seasonDay = seasonDayOf(instant);
  const dailyDigest = await store.freezeDailySelection(seasonDay, (digests) =>
    selectDailyDigest(seasonDay, digests),
  );

  let standings = null;
  if (dailyDigest !== null) {
    const results = await store.qualifyingResults(dailyDigest, seasonDay);
    standings = computeBoard(dailyDigest, RULESET, results, request.account?.id ?? null);
  }

  const streak =
    request.account === null
      ? null
      : streakFrom(await store.dailyVictoryDays(request.account.id), seasonDay);

  return {
    status: 200,
    body: {
      instant: normalizeInstant(instant),
      localTime: localTimeOf(instant),
      seasonDay,
      dailyDigest,
      standings,
      streak,
    },
  };
}

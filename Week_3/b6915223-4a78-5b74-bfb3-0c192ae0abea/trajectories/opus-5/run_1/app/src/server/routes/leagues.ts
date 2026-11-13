import type { Handler } from '../http/server.ts';
import {
  assertSharedLeague,
  createLeague,
  joinLeague,
  leagueSummaries,
  leagueView,
  replaceJoinCode,
} from '../game/leagues.ts';
import { historyView } from '../game/history.ts';
import { snapshotResponse } from './history.ts';
import { broadcast } from '../services/realtime.ts';

export const postLeague: Handler = async (context) => {
  const league = await createLeague(context.manager.id, context.body.name);
  broadcast({ type: 'standings' });
  return { status: 201, body: league };
};

export const postJoinLeague: Handler = async (context) => {
  const league = await joinLeague(context.manager.id, context.body.code);
  broadcast({ type: 'standings' });
  return { status: 200, body: league };
};

export const getLeagues: Handler = async (context) => ({
  status: 200,
  body: { leagues: await leagueSummaries(context.manager.id) },
});

export const getLeague: Handler = async (context) => ({
  status: 200,
  body: await leagueView(context.manager.id, context.params.league!),
});

export const postLeagueCode: Handler = async (context) => ({
  status: 200,
  body: await replaceJoinCode(context.manager.id, context.params.league!),
});

export const getMemberHistory: Handler = async (context) => {
  await assertSharedLeague(
    context.manager.id,
    context.params.league!,
    context.params.member!,
  );
  return { status: 200, body: await historyView(context.params.member!) };
};

export const getMemberSnapshot: Handler = async (context) => {
  await assertSharedLeague(
    context.manager.id,
    context.params.league!,
    context.params.member!,
  );
  return snapshotResponse(context.params.member!, Number(context.params.gameweek));
};

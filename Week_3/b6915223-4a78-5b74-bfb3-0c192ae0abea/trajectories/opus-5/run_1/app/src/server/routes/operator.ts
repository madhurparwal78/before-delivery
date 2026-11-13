import type { Handler } from '../http/server.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { parseFixtures, publishFixtures } from '../game/fixtures.ts';
import { closeGameweek, startGameweek } from '../game/close.ts';
import { eventsFor, parseEventRequest, recordEvent, voidEvent } from '../game/events.ts';
import { parsePriceRun, runPriceChange } from '../game/prices.ts';
import { notFound } from '../http/errors.ts';
import { stableHash } from '../http/idempotency.ts';

const gameweekParam = (value: string | undefined): number => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > TOTAL_GAMEWEEKS) throw notFound();
  return number;
};

export const putFixtures: Handler = async (context) => {
  const number = gameweekParam(context.params.gameweek);
  return {
    status: 200,
    body: await publishFixtures(number, parseFixtures(context.body.fixtures)),
  };
};

export const postStart: Handler = async (context) => ({
  status: 200,
  body: await startGameweek(gameweekParam(context.params.gameweek)),
});

export const postClose: Handler = async (context) => ({
  status: 200,
  body: await closeGameweek(gameweekParam(context.params.gameweek)),
});

export const postEvent: Handler = async (context) => {
  const request = parseEventRequest(context.body);
  const result = await recordEvent(request, stableHash(context.body));
  return {
    status: result.status,
    body: result.body,
    headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : ({} as Record<string, string>),
  };
};

export const postVoidEvent: Handler = async (context) => ({
  status: 200,
  body: await voidEvent(context.params.event!),
});

export const getEvents: Handler = async (context) => ({
  status: 200,
  body: { events: await eventsFor(gameweekParam(context.params.gameweek)) },
});

export const postPriceRun: Handler = async (context) => {
  const { runDate, moves } = parsePriceRun(context.body);
  return { status: 201, body: await runPriceChange(runDate, moves) };
};

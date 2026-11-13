import { matchIdByCode } from '../db/lookup.js';
import { loadMatch } from '../db/matches.js';
import { direct } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import { reply, route } from '../http/router.js';
import { buildScorecard, buildState } from '../laws/present.js';
import { viewerScorecard, viewerState } from '../live/viewer.js';

const viewerBundle = async (code: string) => {
  const matchId = await matchIdByCode(code);
  if (matchId === null) throw notFound();
  return loadMatch(direct, matchId);
};

route('GET', '/api/live/:code/state', { auth: false }, async (ctx) => {
  const code = ctx.params['code'] ?? '';
  const bundle = await viewerBundle(code);
  return reply(200, viewerState(buildState(bundle.view, bundle.ctx), code));
});

route('GET', '/api/live/:code/scorecard', { auth: false }, async (ctx) => {
  const code = ctx.params['code'] ?? '';
  const bundle = await viewerBundle(code);
  return reply(200, viewerScorecard(buildScorecard(bundle.view, bundle.ctx), code));
});

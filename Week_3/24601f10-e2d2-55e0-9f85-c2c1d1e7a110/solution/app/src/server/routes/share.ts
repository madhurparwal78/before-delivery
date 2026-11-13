import type { ShareBody } from '../../shared/api.js';
import { pool } from '../db.js';
import { serverNow } from '../clock.js';
import { fail } from '../errors.js';
import { ok, route } from '../http.js';
import { MSG } from '../messages.js';
import { computeStandings } from '../domain/standings.js';
import { loadDraw, loadTournamentByShare } from '../repo.js';
import { forViewer, matchView, publicEntrant, publicTournament, tournamentView } from '../views.js';

export function registerShare(): void {
  route('GET', '/api/share/:code', async (ctx) => {
    const t = await loadTournamentByShare(pool, ctx.params['code'] as string);
    if (!t) fail('not_found', MSG.linkDead);
    if (t.state === 'draft') fail('not_found', MSG.notPublic);
    const draw = await loadDraw(pool, t.id, 'system', await serverNow());
    if (!draw) fail('not_found', MSG.linkDead);
    const body: ShareBody = {
      tournament: publicTournament(tournamentView(draw, [], 'viewer')),
      entrants: draw.entrants.map(publicEntrant),
      matches: draw.matches.map((m) => forViewer(matchView(draw, m), false)),
      standings: computeStandings(draw),
    };
    return ok(body);
  }, { auth: false });
}

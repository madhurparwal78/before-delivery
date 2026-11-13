import { createHash, randomUUID } from 'node:crypto';
import type { LogoResult, RosterResult } from '../../shared/api.js';
import type { User } from '../auth.js';
import { entrantsMessage, mutate, read, requireOrganizerPowers, tournamentMessage } from '../access.js';
import { pool } from '../db.js';
import { assertNotStarted } from '../domain/lifecycle.js';
import { parseRoster, usernamesIn } from '../domain/roster.js';
import { fail } from '../errors.js';
import { ok, route, type Ctx } from '../http.js';
import { publish } from '../live.js';
import { MSG } from '../messages.js';
import { loadEntrants, loadTournamentByShare, saveTournament } from '../repo.js';
import { getObject, putObject } from '../s3.js';
import { entrantView } from '../views.js';

const me = (ctx: Ctx): User => ctx.user as User;
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

const imageKind = (bytes: Buffer): 'png' | 'jpg' | null =>
  bytes.subarray(0, PNG.length).equals(PNG) ? 'png' : bytes.subarray(0, JPEG.length).equals(JPEG) ? 'jpg' : null;

const contentType = (key: string): string => (key.endsWith('.png') ? 'image/png' : 'image/jpeg');

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function registerFiles(): void {
  route('POST', '/api/tournaments/:id/roster', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const t = a.draw.tournament;
      assertNotStarted(t);
      const file = await ctx.file();
      if (!file.name.endsWith('.cupfold.txt')) fail('validation', MSG.rosterName);
      if (!file.bytes.length) fail('validation', MSG.rosterEmpty);
      // Every file that passes the name and empty checks is stored first, rejected ones too.
      const sha = sha256(file.bytes);
      const key = `rosters/${t.id}/${sha}.cupfold.txt`;
      await putObject(key, file.bytes, 'text/plain; charset=utf-8');
      const decoded = decodeUtf8(file.bytes);
      const names = decoded === null ? [] : usernamesIn(decoded);
      const found = names.length ? (await c.query<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE username = ANY($1)', [names])).rows : [];
      const parsed = decoded === null ? { errors: ['The roster file is not UTF-8 text.'] }
        : parseRoster(decoded, new Set(found.map((u) => u.username)));
      if ('errors' in parsed) fail('roster_invalid', MSG.rosterInvalid, { errors: parsed.errors });
      await c.query('DELETE FROM entrants WHERE tournament_id = $1', [t.id]);
      for (const entry of parsed.entries) {
        await c.query('INSERT INTO entrants (id, tournament_id, name, seed, user_id) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), t.id, entry.name, entry.seed, found.find((u) => u.username === entry.username)?.id ?? null]);
      }
      t.rosterKey = key;
      t.rosterName = file.name;
      t.seedingVersion += 1;
      t.seedingUpdatedBy = a.user.username;
      await saveTournament(c, t);
      a.draw.entrants = await loadEntrants(c, t.id);
      await publish(c, t.id, a.draw.now, [entrantsMessage(a.draw), tournamentMessage(a.draw, a.coOrganizers)]);
      const reply: RosterResult = { entrants: a.draw.entrants.map(entrantView), sha256: sha, file_name: file.name };
      return ok(reply, 201);
    }), { upload: 'roster' });

  route('GET', '/api/tournaments/:id/roster', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    requireOrganizerPowers(a);
    const { rosterKey, rosterName } = a.draw.tournament;
    if (!rosterKey || !rosterName) fail('not_found', MSG.noRoster);
    const bytes = await getObject(rosterKey);
    return { status: 200, raw: bytes, headers: { 'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${rosterName.replace(/["\\\r\n]/g, '_')}"` } };
  });

  route('POST', '/api/tournaments/:id/logo', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const file = await ctx.file();
      const kind = imageKind(file.bytes);
      if (!kind) fail('validation', MSG.logoType);
      const t = a.draw.tournament;
      const sha = sha256(file.bytes);
      const key = `logos/${t.id}/${sha}.${kind}`;
      await putObject(key, file.bytes, contentType(key));
      t.logoKey = key;
      t.logoSha = sha;
      await saveTournament(c, t);
      await publish(c, t.id, a.draw.now, [tournamentMessage(a.draw, a.coOrganizers)]);
      const reply: LogoResult = { logo_url: `/api/tournaments/${t.id}/logo?v=${sha}`, sha256: sha };
      return ok(reply, 201);
    }), { upload: 'logo' });

  route('GET', '/api/tournaments/:id/logo', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    const key = a.draw.tournament.logoKey ?? fail('not_found', MSG.tournamentNotFound);
    return { status: 200, raw: await getObject(key), headers: { 'Content-Type': contentType(key), 'Cache-Control': 'private, max-age=3600' } };
  });

  route('GET', '/api/share/:code/logo', async (ctx) => {
    const t = await loadTournamentByShare(pool, ctx.params['code'] as string);
    if (!t || t.state === 'draft' || !t.logoKey) fail('not_found', MSG.linkDead);
    return { status: 200, raw: await getObject(t.logoKey), headers: { 'Content-Type': contentType(t.logoKey), 'Cache-Control': 'private, max-age=3600' } };
  }, { auth: false });
}

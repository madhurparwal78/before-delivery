import { ERROR_MESSAGES, ROSTER_ERRORS, WRONG_STATE } from '../../shared/copy';
import { requireUser } from '../auth';
import { now } from '../clock';
import { config } from '../config';
import { type Db, newId, pool } from '../db';
import { AppError, invalid, notFound, wrongState } from '../errors';
import { type Ctx, readFilePart, sendJson } from '../http';
import { getObject, putObject, sha256Hex } from '../storage';
import { broadcastEntrants, broadcastStandings, broadcastTournament, type Effects } from '../domain/engine';
import { decodeRoster, parseRoster, rosterUsernames } from '../domain/roster';
import {
  loadEntrants,
  requireOrganizer,
  requireVisible,
  toApiEntrant,
  type TournamentRow,
} from '../domain/tournaments';
import { withTournament } from '../work';

const rosterKey = (tournamentId: string, sha: string): string => `rosters/${tournamentId}/${sha}.cupfold.txt`;

const logoKey = (tournamentId: string, sha: string, extension: string): string =>
  `logos/${tournamentId}/${sha}.${extension}`;

export const uploadRoster = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  if (visible.tournament.state === 'running' || visible.tournament.state === 'finished') {
    throw wrongState(WRONG_STATE.alreadyStarted);
  }
  const file = await readFilePart(ctx.req, config.rosterMaxBytes);
  if (!file.fileName.endsWith('.cupfold.txt')) throw invalid(ROSTER_ERRORS.extension);
  if (file.bytes.length === 0) throw invalid(ROSTER_ERRORS.empty);

  const sha = sha256Hex(file.bytes);
  const key = rosterKey(visible.tournament.id, sha);
  await putObject(key, file.bytes, 'text/plain; charset=utf-8');

  const text = decodeRoster(file.bytes);
  if (text === null) {
    throw new AppError('roster_invalid', ERROR_MESSAGES.rosterInvalid, { errors: [ROSTER_ERRORS.notUtf8] });
  }
  const candidates = rosterUsernames(text);
  const known = new Set<string>();
  if (candidates.length > 0) {
    const { rows } = await pool.query<{ username: string }>('select username from users where username = any($1)', [
      candidates,
    ]);
    for (const row of rows) known.add(row.username);
  }
  const parsed = parseRoster(text, known);
  if (!parsed.ok) {
    throw new AppError('roster_invalid', ERROR_MESSAGES.rosterInvalid, { errors: parsed.errors });
  }

  const entrants = await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query('delete from entrants where tournament_id = $1', [visible.tournament.id]);
    for (const entry of parsed.entrants) {
      const userId = entry.username === null ? null : await usernameId(db, entry.username);
      await db.query('insert into entrants (id, tournament_id, name, seed, user_id) values ($1,$2,$3,$4,$5)', [
        newId(),
        visible.tournament.id,
        entry.name,
        entry.seed,
        userId,
      ]);
    }
    await db.query(
      'update tournaments set roster_key = $2, roster_file_name = $3, roster_sha256 = $4 where id = $1',
      [visible.tournament.id, key, file.fileName, sha],
    );
    const effects: Effects = { db, outbox, tournament: visible.tournament, sentences: [], actor: user.username };
    await broadcastEntrants(effects);
    await broadcastTournament(effects);
    await broadcastStandings(effects);
    return loadEntrants(db, visible.tournament.id);
  });

  sendJson(ctx.res, 201, {
    entrants: entrants.map((row) => toApiEntrant(row, true)),
    sha256: sha,
    file_name: file.fileName,
  });
};

const usernameId = async (db: Db, username: string): Promise<string | null> => {
  const { rows } = await db.query<{ id: string }>('select id from users where username = $1', [username]);
  return rows[0]?.id ?? null;
};

export const downloadRoster = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const { roster_key, roster_file_name } = visible.tournament;
  if (roster_key === null) throw notFound(ERROR_MESSAGES.noRosterFile);
  const object = await getObject(roster_key);
  ctx.res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': object.body.length,
    'content-disposition': `attachment; filename="${roster_file_name ?? 'roster.cupfold.txt'}"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(object.body);
};

const imageKind = (bytes: Buffer): { contentType: string; extension: string } | null => {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
};

export const uploadLogo = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const file = await readFilePart(ctx.req, config.logoMaxBytes);
  const kind = imageKind(file.bytes);
  if (kind === null) throw invalid(ERROR_MESSAGES.logoType);

  const sha = sha256Hex(file.bytes);
  const key = logoKey(visible.tournament.id, sha, kind.extension);
  await putObject(key, file.bytes, kind.contentType);

  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query(
      'update tournaments set logo_key = $2, logo_content_type = $3, logo_sha256 = $4 where id = $1',
      [visible.tournament.id, key, kind.contentType, sha],
    );
    const effects: Effects = { db, outbox, tournament: visible.tournament, sentences: [], actor: user.username };
    await broadcastTournament(effects);
  });
  void now();
  sendJson(ctx.res, 201, { logo_url: `/api/tournaments/${visible.tournament.id}/logo`, sha256: sha });
};

const sendLogo = async (ctx: Ctx, tournament: TournamentRow): Promise<void> => {
  if (tournament.logo_key === null) throw notFound();
  const object = await getObject(tournament.logo_key);
  ctx.res.writeHead(200, {
    'content-type': tournament.logo_content_type ?? object.contentType,
    'content-length': object.body.length,
    'cache-control': 'no-store',
  });
  ctx.res.end(object.body);
};

export const getLogo = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  await sendLogo(ctx, visible.tournament);
};

export const getShareLogo = async (ctx: Ctx): Promise<void> => {
  const { rows } = await pool.query<TournamentRow>('select * from tournaments where share_code = $1', [
    ctx.params.code as string,
  ]);
  const tournament = rows[0];
  if (tournament === undefined) throw notFound(ERROR_MESSAGES.notFoundShare);
  if (tournament.state === 'draft') throw notFound(ERROR_MESSAGES.notPublicYet);
  await sendLogo(ctx, tournament);
};


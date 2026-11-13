import { ERROR_MESSAGES, FIELD_MESSAGES, FIELD_MESSAGES as FM, WRONG_STATE, alreadyCoOrganizer, noAccountNamed, seedRangeMessage } from '../../shared/copy';
import { FORMATS, type Fill, type Format, type PreviewMatch, type Slot } from '../../shared/types';
import { requireUser } from '../auth';
import { now } from '../clock';
import { config } from '../config';
import { type Db, newId, newShareCode, pool } from '../db';
import { AppError, forbidden, notFound, validation, wrongState } from '../errors';
import { type Ctx, readJsonBody, sendEmpty, sendJson } from '../http';
import { closeShareSockets } from '../live';
import {
  broadcastEntrants,
  broadcastStandings,
  broadcastTournament,
  createSwissRound,
  type Effects,
  finishIfDone,
  flushSentences,
  startTournament,
} from '../domain/engine';
import { loadMatches, toApiMatch, type MatchRow } from '../domain/matches';
import { computeStandings } from '../domain/standings';
import { bracketSize, slotOrder } from '../domain/structure';
import {
  coOrganizerUsernames,
  isOrganizerRole,
  loadEntrants,
  loadTournament,
  requireOrganizer,
  requireOwner,
  requireVisible,
  roleFor,
  shareUrl,
  toApiEntrant,
  toApiTournament,
  type EntrantRow,
  type TournamentRow,
  type Visible,
} from '../domain/tournaments';
import { withTournament } from '../work';
import { ANNOUNCE } from '../../shared/copy';

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const validTimeZone = (zone: string): boolean => {
  if (zone === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const effectsFor = (db: Db, tournament: TournamentRow, actor: string | null, outbox: Effects['outbox']): Effects => ({
  db,
  outbox,
  tournament,
  sentences: [],
  actor,
});

const respondTournament = async (ctx: Ctx, db: Db, tournament: TournamentRow, extra: Record<string, unknown> = {}): Promise<void> => {
  const role = await roleFor(db, tournament, ctx.userId);
  sendJson(ctx.res, 200, { tournament: await toApiTournament(db, tournament, role), ...extra });
};

export const listTournaments = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const { rows } = await pool.query<TournamentRow>(
    `select distinct t.* from tournaments t
     left join co_organizers c on c.tournament_id = t.id
     left join entrants e on e.tournament_id = t.id
     where t.organizer_id = $1 or c.user_id = $1 or e.user_id = $1
     order by t.created_at desc`,
    [user.id],
  );
  const tournaments = [];
  for (const row of rows) {
    tournaments.push(await toApiTournament(pool, row, await roleFor(pool, row, user.id)));
  }
  sendJson(ctx.res, 200, { tournaments });
};

export const createTournament = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const name = readString(body.name);
  const format = readString(body.format) as Format;
  const fill = readString(body.fill) as Fill;
  const timeZone = readString(body.time_zone) || 'UTC';
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 60) fields.name = FM.tournamentName;
  if (!FORMATS.includes(format)) fields.format = FM.format;
  if (!['lilac', 'lemon', 'mint'].includes(fill)) fields.fill = FM.fill;
  if (!validTimeZone(timeZone)) fields.time_zone = FM.timeZone;
  if (Object.keys(fields).length > 0) throw validation(fields);

  const id = newId();
  await pool.query(
    `insert into tournaments (id, name, format, time_zone, fill, state, organizer_id, share_code, created_at)
     values ($1,$2,$3,$4,$5,'draft',$6,$7,$8)`,
    [id, name, format, timeZone, fill, user.id, newShareCode(), new Date(now())],
  );
  const tournament = (await loadTournament(pool, id)) as TournamentRow;
  sendJson(ctx.res, 201, { tournament: await toApiTournament(pool, tournament, 'organizer') });
};

export const getTournament = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  sendJson(ctx.res, 200, { tournament: await toApiTournament(pool, visible.tournament, visible.role) });
};

export const patchTournament = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const fields: Record<string, string> = {};
  const patch: Record<string, string> = {};
  if ('name' in body) {
    const name = readString(body.name);
    if (name.length < 1 || name.length > 60) fields.name = FM.tournamentName;
    else patch.name = name;
  }
  if ('fill' in body) {
    const fill = readString(body.fill);
    if (!['lilac', 'lemon', 'mint'].includes(fill)) fields.fill = FM.fill;
    else patch.fill = fill;
  }
  if ('time_zone' in body) {
    const zone = readString(body.time_zone);
    if (!validTimeZone(zone)) fields.time_zone = FM.timeZone;
    else patch.time_zone = zone;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  await withTournament(visible.tournament.id, async (db, outbox) => {
    for (const [column, value] of Object.entries(patch)) {
      await db.query(`update tournaments set ${column} = $2 where id = $1`, [visible.tournament.id, value]);
    }
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastTournament(effects);
  });
  const fresh = (await loadTournament(pool, visible.tournament.id)) as TournamentRow;
  await respondTournament(ctx, pool, fresh);
};

export const deleteTournament = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireOwner(visible, user.id);
  if (visible.tournament.state === 'running' || visible.tournament.state === 'finished') {
    throw wrongState(WRONG_STATE.alreadyStarted);
  }
  await pool.query('delete from tournaments where id = $1', [visible.tournament.id]);
  sendEmpty(ctx.res, 204);
};

export const addCoOrganizer = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireOwner(visible, user.id);
  const username = readString(body.username).toLowerCase();
  const found = await pool.query<{ id: string }>('select id from users where username = $1', [username]);
  const target = found.rows[0];
  if (target === undefined) throw validation({ username: noAccountNamed(username) });
  if (target.id === visible.tournament.organizer_id) {
    throw validation({ username: 'You already organize this tournament.' });
  }
  const existing = await coOrganizerUsernames(pool, visible.tournament.id);
  if (existing.includes(username)) throw validation({ username: alreadyCoOrganizer(username) });
  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query('insert into co_organizers (tournament_id, user_id) values ($1, $2)', [
      visible.tournament.id,
      target.id,
    ]);
    await broadcastTournament(effectsFor(db, visible.tournament, user.username, outbox));
  });
  sendJson(ctx.res, 201, { co_organizers: await coOrganizerUsernames(pool, visible.tournament.id) });
};

export const removeCoOrganizer = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireOwner(visible, user.id);
  const username = (ctx.params.username as string).toLowerCase();
  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query(
      `delete from co_organizers where tournament_id = $1
       and user_id = (select id from users where username = $2)`,
      [visible.tournament.id, username],
    );
    await broadcastTournament(effectsFor(db, visible.tournament, user.username, outbox));
  });
  sendEmpty(ctx.res, 204);
};

const requireBeforeStart = (visible: Visible): void => {
  if (visible.tournament.state === 'running' || visible.tournament.state === 'finished') {
    throw wrongState(WRONG_STATE.alreadyStarted);
  }
};

export const listEntrants = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  sendJson(ctx.res, 200, { entrants: entrants.map((row) => toApiEntrant(row, isOrganizerRole(visible.role))) });
};

const linkUserId = async (db: Db, username: string): Promise<string> => {
  const found = await db.query<{ id: string }>('select id from users where username = $1', [username]);
  const target = found.rows[0];
  if (target === undefined) throw validation({ username: noAccountNamed(username) });
  return target.id;
};

export const addEntrant = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireBeforeStart(visible);
  const name = readString(body.name);
  if (name.length < 1 || [...name].length > 40) throw validation({ name: FM.entrantName });
  const entrants = await loadEntrants(pool, visible.tournament.id);
  if (entrants.some((entrant) => entrant.name.toLowerCase() === name.toLowerCase())) {
    throw validation({ name: FM.duplicateEntrant });
  }
  const username = body.username === undefined || body.username === null ? null : readString(body.username).toLowerCase();
  const userIdToLink = username === null ? null : await linkUserId(pool, username);

  const entrant = await withTournament(visible.tournament.id, async (db, outbox) => {
    if (userIdToLink !== null) {
      await db.query('update entrants set user_id = null where tournament_id = $1 and user_id = $2', [
        visible.tournament.id,
        userIdToLink,
      ]);
    }
    const id = newId();
    await db.query(
      'insert into entrants (id, tournament_id, name, seed, user_id) values ($1,$2,$3,$4,$5)',
      [id, visible.tournament.id, name, entrants.length + 1, userIdToLink],
    );
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastEntrants(effects);
    await broadcastTournament(effects);
    await broadcastStandings(effects);
    const rows = await loadEntrants(db, visible.tournament.id);
    return rows.find((row) => row.id === id) as EntrantRow;
  });
  sendJson(ctx.res, 201, { entrant: toApiEntrant(entrant, true) });
};

const entrantContext = async (entrantId: string, userId: string): Promise<{ entrant: EntrantRow; visible: Visible }> => {
  const { rows } = await pool.query<{ tournament_id: string }>('select tournament_id from entrants where id = $1', [
    entrantId,
  ]);
  const owner = rows[0];
  if (owner === undefined) throw notFound();
  const visible = await requireVisible(pool, owner.tournament_id, userId);
  const entrants = await loadEntrants(pool, owner.tournament_id);
  const entrant = entrants.find((row) => row.id === entrantId);
  if (entrant === undefined) throw notFound();
  return { entrant, visible };
};

export const patchEntrant = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const { entrant, visible } = await entrantContext(ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireBeforeStart(visible);
  const raw = body.username;
  const username = raw === null || raw === undefined || readString(raw) === '' ? null : readString(raw).toLowerCase();
  const userIdToLink = username === null ? null : await linkUserId(pool, username);
  const updated = await withTournament(visible.tournament.id, async (db, outbox) => {
    if (userIdToLink !== null) {
      await db.query('update entrants set user_id = null where tournament_id = $1 and user_id = $2', [
        visible.tournament.id,
        userIdToLink,
      ]);
    }
    await db.query('update entrants set user_id = $2 where id = $1', [entrant.id, userIdToLink]);
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastEntrants(effects);
    const rows = await loadEntrants(db, visible.tournament.id);
    return rows.find((row) => row.id === entrant.id) as EntrantRow;
  });
  sendJson(ctx.res, 200, { entrant: toApiEntrant(updated, true) });
};

const renumberSeeds = async (db: Db, tournamentId: string): Promise<void> => {
  const entrants = await loadEntrants(db, tournamentId);
  for (let index = 0; index < entrants.length; index += 1) {
    await db.query('update entrants set seed = $2 where id = $1', [(entrants[index] as EntrantRow).id, index + 1]);
  }
};

export const deleteEntrant = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const { entrant, visible } = await entrantContext(ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireBeforeStart(visible);
  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query('delete from entrants where id = $1', [entrant.id]);
    await renumberSeeds(db, visible.tournament.id);
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastEntrants(effects);
    await broadcastTournament(effects);
    await broadcastStandings(effects);
  });
  sendEmpty(ctx.res, 204);
};

export const putSeeding = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  requireBeforeStart(visible);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  const order = Array.isArray(body.order) ? (body.order as unknown[]).map((value) => String(value)) : [];
  const sameSet =
    order.length === entrants.length && entrants.every((entrant) => order.filter((id) => id === entrant.id).length === 1);
  if (!sameSet) throw validation({ order: seedRangeMessage(entrants.length) });
  if (body.seeding_version !== visible.tournament.seeding_version) {
    throw new AppError('stale_seeding', ERROR_MESSAGES.staleSeeding(visible.tournament.seeding_by ?? 'system'), {
      entrants: entrants.map((row) => toApiEntrant(row, true)),
    });
  }

  const result = await withTournament(visible.tournament.id, async (db, outbox) => {
    for (let index = 0; index < order.length; index += 1) {
      await db.query('update entrants set seed = $2 where id = $1', [order[index], index + 1]);
    }
    await db.query('update tournaments set seeding_version = seeding_version + 1, seeding_by = $2 where id = $1', [
      visible.tournament.id,
      user.username,
    ]);
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastEntrants(effects);
    await broadcastTournament(effects);
    await broadcastStandings(effects);
    const rows = await loadEntrants(db, visible.tournament.id);
    const fresh = (await loadTournament(db, visible.tournament.id)) as TournamentRow;
    return { rows, seeding_version: fresh.seeding_version };
  });
  sendJson(ctx.res, 200, {
    entrants: result.rows.map((row) => toApiEntrant(row, true)),
    seeding_version: result.seeding_version,
  });
};

/** Round 1, or winners round 1, for the current seeding. */
export const getPreview = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  const matches: PreviewMatch[] = [];
  const slotFor = (seed: number): Slot => {
    const entrant = entrants.find((row) => row.seed === seed);
    return entrant === undefined ? { bye: true } : { entrant_id: entrant.id, name: entrant.name };
  };

  if (visible.tournament.format === 'round_robin' || visible.tournament.format === 'swiss') {
    const seats = entrants.length % 2 === 0 ? entrants.length : entrants.length + 1;
    if (visible.tournament.format === 'round_robin') {
      for (let i = 1; i <= seats / 2; i += 1) {
        matches.push({ number: i, upper: slotFor(i), lower: slotFor(seats + 1 - i) });
      }
    } else {
      const half = Math.floor(entrants.length / 2);
      for (let i = 1; i <= half; i += 1) {
        matches.push({ number: i, upper: slotFor(i), lower: slotFor(i + half) });
      }
      if (entrants.length % 2 === 1) {
        matches.push({ number: half + 1, upper: slotFor(entrants.length), lower: { bye: true } });
      }
    }
  } else if (entrants.length >= 2) {
    const size = bracketSize(entrants.length);
    const order = slotOrder(size);
    for (let m = 1; m <= size / 2; m += 1) {
      matches.push({
        number: m,
        upper: slotFor(order[2 * m - 2] as number),
        lower: slotFor(order[2 * m - 1] as number),
      });
    }
  }
  sendJson(ctx.res, 200, { matches });
};

export const openCheckin = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const state = visible.tournament.state;
  if (state === 'checkin_open') throw wrongState(WRONG_STATE.checkinAlreadyOpen);
  if (state === 'checkin_closed') throw wrongState(WRONG_STATE.checkinAlreadyClosed);
  if (state === 'running' || state === 'finished') throw wrongState(WRONG_STATE.alreadyStarted);

  let closesAt: number;
  if (body.closes_at === undefined || body.closes_at === null || body.closes_at === '') {
    closesAt = now() + config.checkinDefaultMs;
  } else {
    const parsed = typeof body.closes_at === 'string' ? Date.parse(body.closes_at) : Number.NaN;
    if (Number.isNaN(parsed)) throw validation({ closes_at: FIELD_MESSAGES.checkinFormat });
    if (parsed <= now()) throw validation({ closes_at: FIELD_MESSAGES.checkinAfterNow });
    closesAt = parsed;
  }

  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query(
      `update tournaments set state = 'checkin_open', checkin_closes_at = $2, checkin_closed_at = null where id = $1`,
      [visible.tournament.id, new Date(closesAt)],
    );
    await broadcastTournament(effectsFor(db, visible.tournament, user.username, outbox));
  });
  const fresh = (await loadTournament(pool, visible.tournament.id)) as TournamentRow;
  await respondTournament(ctx, pool, fresh);
};

export const closeCheckinRoute = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const state = visible.tournament.state;
  if (state === 'running' || state === 'finished') throw wrongState(WRONG_STATE.alreadyStarted);
  if (state !== 'checkin_open') throw wrongState(WRONG_STATE.checkinNotOpen);
  await withTournament(visible.tournament.id, async (db, outbox) => {
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await db.query(`update tournaments set state = 'checkin_closed', checkin_closed_at = $2 where id = $1`, [
      visible.tournament.id,
      new Date(now()),
    ]);
    effects.sentences.push(ANNOUNCE.checkinClosed);
    await broadcastTournament(effects);
    flushSentences(effects);
  });
  const fresh = (await loadTournament(pool, visible.tournament.id)) as TournamentRow;
  await respondTournament(ctx, pool, fresh);
};

export const backToDraft = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const state = visible.tournament.state;
  if (state === 'draft') throw wrongState(WRONG_STATE.alreadyDraft);
  if (state === 'running' || state === 'finished') throw wrongState(WRONG_STATE.alreadyStarted);
  await withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query(
      `update tournaments set state = 'draft', checkin_closes_at = null, checkin_closed_at = null where id = $1`,
      [visible.tournament.id],
    );
    await db.query('update entrants set checked_in = false where tournament_id = $1', [visible.tournament.id]);
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    await broadcastEntrants(effects);
    await broadcastTournament(effects);
  });
  const fresh = (await loadTournament(pool, visible.tournament.id)) as TournamentRow;
  await respondTournament(ctx, pool, fresh);
};

const checkinStateGuard = (tournament: TournamentRow): void => {
  if (tournament.state === 'draft') throw wrongState(WRONG_STATE.checkinNotOpen);
  if (tournament.state !== 'checkin_open') {
    throw new AppError('checkin_closed', ERROR_MESSAGES.checkinClosed);
  }
  if (tournament.checkin_closes_at !== null && tournament.checkin_closes_at.getTime() <= now()) {
    throw new AppError('checkin_closed', ERROR_MESSAGES.checkinClosed);
  }
};

const markCheckedIn = async (
  visible: Visible,
  entrant: EntrantRow,
  checkedIn: boolean,
  actor: string,
): Promise<{ entrant: EntrantRow; count: number }> =>
  withTournament(visible.tournament.id, async (db, outbox) => {
    await db.query('update entrants set checked_in = $2 where id = $1', [entrant.id, checkedIn]);
    const entrants = await loadEntrants(db, visible.tournament.id);
    const fresh = entrants.find((row) => row.id === entrant.id) as EntrantRow;
    const count = entrants.filter((row) => row.checked_in).length;
    const effects = effectsFor(db, visible.tournament, actor, outbox);
    outbox.add('checkin.updated', {
      checked_in_count: count,
      entrant: { name: fresh.name, checked_in: fresh.checked_in },
    });
    if (checkedIn) effects.sentences.push(ANNOUNCE.checkedIn(fresh.name));
    await broadcastTournament(effects);
    flushSentences(effects);
    return { entrant: fresh, count };
  });

export const playerCheckin = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  const entrant = entrants.find((row) => row.user_id === user.id);
  if (entrant === undefined) throw forbidden();
  checkinStateGuard(visible.tournament);
  if (entrant.checked_in) {
    sendJson(ctx.res, 200, {
      entrant: toApiEntrant(entrant, isOrganizerRole(visible.role)),
      checked_in_count: entrants.filter((row) => row.checked_in).length,
    });
    return;
  }
  const result = await markCheckedIn(visible, entrant, true, user.username);
  sendJson(ctx.res, 200, {
    entrant: toApiEntrant(result.entrant, isOrganizerRole(visible.role)),
    checked_in_count: result.count,
  });
};

export const organizerCheckin = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req);
  const { entrant, visible } = await entrantContext(ctx.params.id as string, user.id);
  requireOrganizer(visible);
  checkinStateGuard(visible.tournament);
  const checkedIn = body.checked_in !== false;
  const result = await markCheckedIn(visible, entrant, checkedIn, user.username);
  sendJson(ctx.res, 200, { entrant: toApiEntrant(result.entrant, true), checked_in_count: result.count });
};

export const startTournamentRoute = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const state = visible.tournament.state;
  if (state === 'running' || state === 'finished') throw wrongState(WRONG_STATE.alreadyStarted);
  if (state === 'checkin_open') throw wrongState(WRONG_STATE.closeCheckinFirst);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  if (state === 'draft' && entrants.length < 2) throw wrongState(WRONG_STATE.needTwoEntrants);
  if (state === 'checkin_closed' && entrants.filter((row) => row.checked_in).length < 2) {
    throw wrongState(WRONG_STATE.needTwoCheckedIn);
  }

  const removed = await withTournament(visible.tournament.id, async (db, outbox) => {
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    let names: string[] = [];
    if (state === 'checkin_closed') {
      const noShows = entrants.filter((row) => !row.checked_in);
      names = noShows.map((row) => row.name);
      for (const noShow of noShows) {
        await db.query('delete from entrants where id = $1', [noShow.id]);
      }
      await renumberSeeds(db, visible.tournament.id);
      await broadcastEntrants(effects);
    }
    const field = await loadEntrants(db, visible.tournament.id);
    await startTournament(effects, field);
    return names;
  });
  const fresh = (await loadTournament(pool, visible.tournament.id)) as TournamentRow;
  await respondTournament(ctx, pool, fresh, { removed });
};

export const nextSwissRound = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  if (visible.tournament.format !== 'swiss') throw wrongState(WRONG_STATE.onlySwissRounds);
  if (visible.tournament.state === 'finished') throw wrongState(WRONG_STATE.finished);
  if (visible.tournament.state !== 'running') throw wrongState(WRONG_STATE.notRunning);

  const result = await withTournament(visible.tournament.id, async (db, outbox) => {
    const matches = await loadMatches(db, visible.tournament.id);
    const lastRound = matches.reduce((highest, match) => Math.max(highest, match.round), 0);
    const unfinished = matches.some(
      (match) =>
        match.round === lastRound && ['pending', 'called', 'reported', 'disputed'].includes(match.state),
    );
    if (unfinished) throw wrongState(WRONG_STATE.finishRoundFirst(lastRound));
    const entrants = await loadEntrants(db, visible.tournament.id);
    const effects = effectsFor(db, visible.tournament, user.username, outbox);
    const created = await createSwissRound(effects, entrants, matches, lastRound + 1);
    if (created === null) throw wrongState(WRONG_STATE.noPairing);
    for (const match of created) outbox.add('match.updated', { match: toApiMatch(match, true) });
    effects.sentences.push(ANNOUNCE.roundPaired(lastRound + 1));
    await broadcastTournament(effects);
    await broadcastStandings(effects);
    await finishIfDone(effects);
    flushSentences(effects);
    return { round: lastRound + 1, matches: created };
  });
  sendJson(ctx.res, 201, {
    round: result.round,
    matches: result.matches.map((match) => toApiMatch(match, true)),
  });
};

export const listMatches = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const matches = await loadMatches(pool, visible.tournament.id);
  sendJson(ctx.res, 200, { matches: matches.map((row) => toApiMatch(row, isOrganizerRole(visible.role))) });
};

export const getStandings = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const { format } = visible.tournament;
  if (format !== 'round_robin' && format !== 'swiss') throw wrongState(WRONG_STATE.standingsOnly);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  const matches = await loadMatches(pool, visible.tournament.id);
  sendJson(ctx.res, 200, computeStandings(format, entrants, matches));
};

const nextMatchFor = (matches: MatchRow[], entrantId: string): MatchRow | null =>
  matches.find(
    (match) =>
      ['pending', 'called', 'reported', 'disputed'].includes(match.state) &&
      (match.upper_entrant_id === entrantId || match.lower_entrant_id === entrantId) &&
      match.upper_entrant_id !== null &&
      match.lower_entrant_id !== null,
  ) ?? null;

export const myEntrant = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  const entrants = await loadEntrants(pool, visible.tournament.id);
  const entrant = entrants.find((row) => row.user_id === user.id);
  if (entrant === undefined) throw notFound();
  const matches = await loadMatches(pool, visible.tournament.id);
  const next = nextMatchFor(matches, entrant.id);
  sendJson(ctx.res, 200, {
    entrant: toApiEntrant(entrant, isOrganizerRole(visible.role)),
    checked_in: entrant.checked_in,
    next_match: next === null ? null : toApiMatch(next, isOrganizerRole(visible.role)),
  });
};

export const listDisputes = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const matches = await loadMatches(pool, visible.tournament.id);
  sendJson(ctx.res, 200, {
    matches: matches.filter((match) => match.state === 'disputed').map((row) => toApiMatch(row, true)),
  });
};

export const rotateShare = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  const visible = await requireVisible(pool, ctx.params.id as string, user.id);
  requireOrganizer(visible);
  const oldCode = visible.tournament.share_code;
  const code = newShareCode();
  await pool.query('update tournaments set share_code = $2 where id = $1', [visible.tournament.id, code]);
  closeShareSockets(visible.tournament.id, oldCode);
  sendJson(ctx.res, 200, { share_url: shareUrl(code) });
};

export const getConfig = async (ctx: Ctx): Promise<void> => {
  sendJson(ctx.res, 200, {
    server_time: new Date(now()).toISOString(),
    confirm_window_ms: config.confirmWindowMs,
    match_limit_ms: config.matchLimitMs,
    swiss_round_ms: config.swissRoundMs,
    toast_ms: config.toastMs,
    roster_max_bytes: config.rosterMaxBytes,
    logo_max_bytes: config.logoMaxBytes,
  });
  await Promise.resolve();
};


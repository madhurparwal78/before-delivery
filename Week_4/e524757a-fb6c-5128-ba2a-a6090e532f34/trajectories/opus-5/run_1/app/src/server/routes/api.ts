import { createHash } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import type { Heading } from '../../shared/islands.js';
import { config, MAIN_WORLD } from '../config.js';
import { pingDatabase, query, transaction } from '../db.js';
import { albums, lighthouseState, stampCount } from '../domain/albums.js';
import { board, enterPhoto } from '../domain/boards.js';
import { filmCount } from '../domain/film.js';
import {
  checkHallUpdate,
  likeablePhoto,
  maySeePhotoImage,
  ownHall,
  saveHall,
  setLike,
  visibleHall,
} from '../domain/halls.js';
import {
  approveNote,
  checkNoteText,
  declineNote,
  pendingNotes,
  pinNote,
  removeNote,
  visibleNotes,
} from '../domain/notes.js';
import {
  checkEmail,
  checkName,
  checkPassword,
  checkSettings,
  confirmationCode,
  createPlayer,
  endSession,
  playerByEmail,
  progressOf,
  publicPlayer,
  refillFilm,
  restartExpedition,
  savePosition,
  saveSettings,
  settingsOf,
  startSession,
  verifyPassword,
  type PlayerRow,
} from '../domain/players.js';
import {
  imageContentType,
  keepPhoto,
  parsePose,
  photoAnswer,
  photoById,
  poseFingerprint,
  type PhotoRow,
} from '../domain/photos.js';
import { postPostcard, publicPostcard } from '../domain/postcards.js';
import {
  currentSafari,
  endSafari,
  joinSafari,
  leaveSafari,
  markSighting,
  relayPosition,
  startSafari,
} from '../domain/safaris.js';
import { worldState } from '../domain/world.js';
import {
  checkOrigin,
  parseMultipart,
  readJson,
  readRawBody,
  sendJson,
  sendNoContent,
  setSessionCookie,
  clearSessionCookie,
  type Ctx,
  type Router,
} from '../http.js';
import { isUuid } from '../ids.js';
import { publish, streamLive } from '../live.js';
import { MailUnreachable, sendConfirmationCode } from '../mail.js';
import { createGradingWorld } from '../seed.js';
import { getPhoto, pingStorage, StorageUnreachable } from '../storage.js';
import { requirePlayer, viewerOf } from '../session.js';

async function player(ctx: Ctx): Promise<PlayerRow> {
  return requirePlayer(ctx);
}

type KeyedAnswer = { status: number; body: unknown };

type KeyRow = { fingerprint: string; status: number | null; response: unknown };

async function readKey(playerId: string, scope: string, key: string): Promise<KeyRow | null> {
  const found = await query<KeyRow>(
    'SELECT fingerprint, status, response FROM request_keys WHERE player_id = $1 AND scope = $2 AND key = $3',
    [playerId, scope, key],
  );
  return found.rows[0] ?? null;
}

async function storedAnswer(
  playerId: string,
  scope: string,
  key: string,
  fingerprint: string,
  reuseCode: 'shot_key_reused' | 'request_key_reused',
): Promise<KeyedAnswer | null> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const row = await readKey(playerId, scope, key);
    if (!row) return null;
    if (row.fingerprint !== fingerprint) throw new ApiError(reuseCode);
    if (row.status !== null) return { status: row.status, body: row.response };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new ApiError('bad_request');
}

/**
 * One request key makes one change: a replay with the same content answers before any other check,
 * the published pre-checks run next, and only then does other content under the same key conflict.
 */
async function withRequestKey(
  playerId: string,
  scope: 'photo' | 'note' | 'postcard',
  key: string | null,
  fingerprint: string,
  options: { preCheck?: () => Promise<void>; run: () => Promise<KeyedAnswer> },
): Promise<KeyedAnswer> {
  const reuseCode = scope === 'photo' ? 'shot_key_reused' : 'request_key_reused';
  if (!key) {
    if (options.preCheck) await options.preCheck();
    return options.run();
  }
  const existing = await readKey(playerId, scope, key);
  if (existing && existing.fingerprint === fingerprint) {
    const replay = await storedAnswer(playerId, scope, key, fingerprint, reuseCode);
    if (replay) return replay;
  }
  if (options.preCheck) await options.preCheck();
  const claimed = await query(
    `INSERT INTO request_keys (player_id, key, scope, fingerprint) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [playerId, key, scope, fingerprint],
  );
  if (claimed.rowCount === 0) {
    const replay = await storedAnswer(playerId, scope, key, fingerprint, reuseCode);
    if (replay) return replay;
    throw new ApiError(reuseCode);
  }
  try {
    const answer = await options.run();
    await query(
      'UPDATE request_keys SET status = $5, response = $6 WHERE player_id = $1 AND scope = $3 AND key = $2 AND fingerprint = $4',
      [playerId, key, scope, fingerprint, answer.status, JSON.stringify(answer.body)],
    );
    return answer;
  } catch (error) {
    await query('DELETE FROM request_keys WHERE player_id = $1 AND scope = $2 AND key = $3', [playerId, scope, key]);
    throw error;
  }
}

function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function headerValue(ctx: Ctx, name: string): string | null {
  const value = ctx.req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function registerApi(router: Router): void {
  router.get('/api/health', async (ctx) => {
    const within = (check: Promise<boolean>): Promise<boolean> =>
      Promise.race([check, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))]);
    const [database, storage] = await Promise.all([within(pingDatabase()), within(pingStorage())]);
    sendJson(ctx, 200, { status: database && storage ? 'ok' : 'unavailable' });
  });

  router.post('/api/signup', async (ctx) => {
    checkOrigin(ctx);
    const body = await readJson(ctx);
    const name = checkName(body.name);
    const email = checkEmail(body.email);
    const password = checkPassword(body.password);
    const existing = await playerByEmail({ query }, email);
    if (existing) throw new ApiError('email_taken');
    const code = confirmationCode();
    const created = await transaction((db) =>
      createPlayer(db, { worldId: MAIN_WORLD, name, email, password, code }),
    );
    let codeSent = true;
    try {
      await sendConfirmationCode(email, code);
    } catch {
      codeSent = false;
    }
    setSessionCookie(ctx, await startSession({ query }, created.id));
    sendJson(ctx, 201, { player: publicPlayer(created, true), code_sent: codeSent });
  });

  router.post('/api/session', async (ctx) => {
    checkOrigin(ctx);
    const body = await readJson(ctx);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const found = await playerByEmail({ query }, email);
    if (!found || !verifyPassword(password, found.password_hash)) throw new ApiError('bad_credentials');
    setSessionCookie(ctx, await startSession({ query }, found.id));
    sendJson(ctx, 200, { player: publicPlayer(found, true) });
  });

  router.delete('/api/session', async (ctx) => {
    checkOrigin(ctx);
    const viewer = await viewerOf(ctx);
    if (viewer.sessionId) await endSession(viewer.sessionId);
    clearSessionCookie(ctx);
    sendNoContent(ctx);
  });

  router.post('/api/confirm', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    if (me.confirmed) {
      sendJson(ctx, 200, { player: publicPlayer(me, true) });
      return;
    }
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (me.confirm_code === null || code !== me.confirm_code) throw new ApiError('bad_code');
    if (me.confirm_expires_at && me.confirm_expires_at.getTime() < Date.now()) throw new ApiError('code_expired');
    await query('UPDATE players SET confirmed = true, confirm_code = NULL WHERE id = $1', [me.id]);
    sendJson(ctx, 200, { player: publicPlayer({ ...me, confirmed: true }, true) });
  });

  router.post('/api/confirm/resend', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const code = confirmationCode();
    try {
      await sendConfirmationCode(me.email, code);
    } catch (error) {
      if (error instanceof MailUnreachable) throw new ApiError('mail_unavailable', { variant: 'new_code' });
      throw error;
    }
    await query('UPDATE players SET confirm_code = $2, confirm_expires_at = $3 WHERE id = $1', [
      me.id,
      code,
      new Date(Date.now() + config.confirmCodeTtlSeconds * 1000),
    ]);
    sendJson(ctx, 200, { sent: true });
  });

  router.get('/api/me', async (ctx) => {
    const me = await player(ctx);
    const progress = await progressOf({ query }, me);
    sendJson(ctx, 200, { player: publicPlayer(me, true), ...progress, settings: settingsOf(me) });
  });

  router.put('/api/me/position', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const island = body.island;
    const tile = body.tile;
    const heading = body.heading;
    if (
      !Number.isInteger(island) ||
      (island as number) < 1 ||
      (island as number) > 5 ||
      !Array.isArray(tile) ||
      tile.length !== 2 ||
      !Number.isInteger(tile[0]) ||
      !Number.isInteger(tile[1]) ||
      (heading !== 'N' && heading !== 'E' && heading !== 'S' && heading !== 'W')
    )
      throw new ApiError('bad_request');
    await savePosition({ query }, me.id, island as number, tile[0] as number, tile[1] as number, heading as Heading);
    await relayPosition(me, island as number, [tile[0] as number, tile[1] as number]);
    sendJson(ctx, 200, {
      position: { island, tile, heading },
    });
  });

  router.get('/api/me/albums', async (ctx) => {
    const me = await player(ctx);
    const list = await albums({ query }, me.id);
    const stamps = await stampCount({ query }, me.id);
    sendJson(ctx, 200, {
      albums: list,
      stamps,
      lighthouse: lighthouseState(stamps),
      film: await filmCount({ query }, me.id),
    });
  });

  router.post('/api/me/refill', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const film = await transaction((db) => refillFilm(db, me));
    await publish({ query }, me.world_id, me.id, 'progress', { film });
    sendJson(ctx, 200, { film });
  });

  router.post('/api/me/restart', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const progress = await transaction((db) => restartExpedition(db, me));
    await publish({ query }, me.world_id, me.id, 'progress', { ...progress, restarted: true });
    sendJson(ctx, 200, progress);
  });

  router.get('/api/me/settings', async (ctx) => {
    const me = await player(ctx);
    sendJson(ctx, 200, { settings: settingsOf(me) });
  });

  router.put('/api/me/settings', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const settings = checkSettings(await readJson(ctx));
    sendJson(ctx, 200, { settings: await saveSettings({ query }, me.id, settings) });
  });

  router.get('/api/world', async (ctx) => {
    const me = await player(ctx);
    const state = await worldState(me.world_id);
    const stamps = await stampCount({ query }, me.id);
    sendJson(ctx, 200, {
      world: state.id,
      tick: state.tick,
      hour: state.hour,
      minute: state.minute,
      time: state.time,
      weather: state.weather,
      dusk: state.dusk,
      lighthouse: lighthouseState(stamps),
      creatures: state.creatures,
    });
  });

  router.get('/api/live', async (ctx) => {
    const me = await player(ctx);
    await streamLive(ctx, me.id, me.world_id);
  });

  router.post('/api/photos', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const raw = await readRawBody(ctx, config.photoMaxBytes + 64000);
    const contentType = headerValue(ctx, 'content-type') ?? '';
    const parts = parseMultipart(raw, contentType);
    const imagePart = parts.find((part) => part.name === 'image');
    const posePart = parts.find((part) => part.name === 'pose');
    if (!imagePart || !posePart) throw new ApiError('bad_request');
    const poseText = posePart.data.toString('utf8');
    const shotKey = headerValue(ctx, 'shot-key');

    const answer = await withRequestKey(me.id, 'photo', shotKey, poseFingerprint(poseText), {
      preCheck: async () => {
        if (imagePart.data.byteLength > config.photoMaxBytes)
          throw new ApiError('photo_too_large', { limit: config.photoMaxBytes });
        if (!imageContentType(imagePart.data)) throw new ApiError('not_an_image');
        if ((await filmCount({ query }, me.id)) <= 0) throw new ApiError('out_of_film');
      },
      run: async () => {
        const kind = imageContentType(imagePart.data)!;
        const pose = parsePose(poseText);
        try {
          const kept = await keepPhoto(me, pose, imagePart.data, kind);
          return {
            status: 201,
            body: { photo: { ...kept.photo, measures: kept.measures, album: kept.album, film: kept.film } },
          };
        } catch (error) {
          if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable', { variant: 'photo' });
          throw error;
        }
      },
    });
    sendJson(ctx, answer.status, answer.body);
  });

  router.get('/api/me/photos', async (ctx) => {
    const me = await player(ctx);
    const found = await query<PhotoRow>('SELECT * FROM photos WHERE player_id = $1 ORDER BY created_at DESC', [me.id]);
    sendJson(ctx, 200, { photos: found.rows.map(photoAnswer) });
  });

  router.get('/api/photos/:id', async (ctx) => {
    const me = await player(ctx);
    const found = await photoById(ctx.params.id);
    if (!found) throw new ApiError('not_found');
    if (found.player_id !== me.id && !(await maySeePhotoImage(found.id, me.id))) throw new ApiError('not_found');
    sendJson(ctx, 200, { photo: photoAnswer(found) });
  });

  router.get('/api/photos/:id/image', async (ctx) => {
    const viewer = await viewerOf(ctx);
    const found = await photoById(ctx.params.id);
    if (!found) throw new ApiError('not_found');
    if (!(await maySeePhotoImage(found.id, viewer.player?.id ?? null))) throw new ApiError('not_found');
    let image;
    try {
      image = await getPhoto(found.image_key);
    } catch (error) {
      if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable', { variant: 'image' });
      throw error;
    }
    ctx.res.writeHead(200, {
      'content-type': image.contentType,
      'content-length': String(image.body.byteLength),
      'cache-control': 'no-store',
    });
    ctx.res.end(ctx.method === 'HEAD' ? undefined : image.body);
  });

  router.get('/api/me/hall', async (ctx) => {
    const me = await player(ctx);
    sendJson(ctx, 200, { hall: await ownHall({ query }, me) });
  });

  router.put('/api/me/hall', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const update = checkHallUpdate(await readJson(ctx));
    const hall = await saveHall(me, update);
    await publish({ query }, me.world_id, null, 'hall', { handle: me.handle, public: hall.public });
    sendJson(ctx, 200, { hall });
  });

  router.get('/api/halls/:handle', async (ctx) => {
    const viewer = await viewerOf(ctx);
    sendJson(ctx, 200, { hall: await visibleHall(ctx.params.handle, viewer.player?.id ?? null) });
  });

  router.put('/api/photos/:id/like', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    sendJson(ctx, 200, await applyLike(me, ctx.params.id, true));
  });

  router.delete('/api/photos/:id/like', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    sendJson(ctx, 200, await applyLike(me, ctx.params.id, false));
  });

  router.post('/api/safaris', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const started = await startSafari(me);
    sendJson(ctx, started.created ? 201 : 200, { safari: { ...started.safari, guest: started.safari.guest } });
  });

  router.get('/api/safaris/current', async (ctx) => {
    const me = await player(ctx);
    const safari = await currentSafari(me.id);
    sendJson(ctx, 200, { safari: safari ? stripIds(safari) : null });
  });

  router.post('/api/safaris/:code/join', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    sendJson(ctx, 200, { safari: await joinSafari(me, ctx.params.code) });
  });

  router.post('/api/safaris/:code/sightings', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const island = body.island;
    const tile = body.tile;
    if (!Number.isInteger(island) || !Array.isArray(tile) || tile.length !== 2) throw new ApiError('bad_request');
    const sighting = await markSighting(me, ctx.params.code, island as number, [tile[0] as number, tile[1] as number]);
    sendJson(ctx, 201, { sighting });
  });

  router.post('/api/safaris/:code/leave', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    sendJson(ctx, 200, { safari: await leaveSafari(me, ctx.params.code) });
  });

  router.post('/api/safaris/:code/end', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    sendJson(ctx, 200, { safari: await endSafari(me, ctx.params.code) });
  });

  router.get('/api/notes', async (ctx) => {
    const me = await player(ctx);
    sendJson(ctx, 200, { notes: await visibleNotes(me.world_id, me.id) });
  });

  router.post('/api/notes', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const key = headerValue(ctx, 'request-key');
    const answer = await withRequestKey(me.id, 'note', key, fingerprintOf(body), {
      run: async () => {
        const text = checkNoteText(body.text);
        const note = await pinNote(me, text);
        return { status: 201, body: { note: { id: note.id, text: note.text, status: note.status } } };
      },
    });
    sendJson(ctx, answer.status, answer.body);
  });

  router.get('/api/ranger/notes', async (ctx) => {
    const me = await player(ctx);
    if (!me.ranger) throw new ApiError('not_ranger');
    sendJson(ctx, 200, { notes: await pendingNotes(me.world_id) });
  });

  router.post('/api/notes/:id/approve', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const note = await approveNote(me, ctx.params.id);
    sendJson(ctx, 200, { note: { id: note.id, status: 'approved', decided_by: me.name } });
  });

  router.post('/api/notes/:id/decline', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const note = await declineNote(me, ctx.params.id, body.reason);
    sendJson(ctx, 200, { note: { id: note.id, status: 'declined', decided_by: me.name, reason: note.reason } });
  });

  router.delete('/api/notes/:id', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    await removeNote(me, ctx.params.id);
    sendNoContent(ctx);
  });

  router.post('/api/postcards', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const key = headerValue(ctx, 'request-key');
    const answer = await withRequestKey(me.id, 'postcard', key, fingerprintOf(body), {
      run: async () => {
        const postcard = await postPostcard(me, {
          photo: body.photo,
          recipient: body.recipient,
          line: body.line,
        });
        return { status: 201, body: { postcard } };
      },
    });
    sendJson(ctx, answer.status, answer.body);
  });

  router.get('/api/postcards/:id', async (ctx) => {
    sendJson(ctx, 200, { postcard: await publicPostcard(ctx.params.id) });
  });

  router.get('/api/boards/:island', async (ctx) => {
    const me = await player(ctx);
    const island = Number.parseInt(ctx.params.island, 10);
    const filter = ctx.url.searchParams.get('player');
    sendJson(ctx, 200, await board(me.world_id, island, filter));
  });

  router.post('/api/boards/:island/entries', async (ctx) => {
    checkOrigin(ctx);
    const me = await player(ctx);
    const body = await readJson(ctx);
    const island = Number.parseInt(ctx.params.island, 10);
    const entered = await enterPhoto(me, island, body.photo);
    sendJson(ctx, entered.created ? 201 : 200, { entry: entered.entry });
  });

  if (config.gradingRoutes) {
    router.post('/api/grading/world', async (ctx) => {
      const body = await readJson(ctx);
      const tick = body.tick === undefined ? 6000 : body.tick;
      if (!Number.isInteger(tick) || (tick as number) < 0) throw new ApiError('bad_request');
      try {
        sendJson(ctx, 201, await createGradingWorld(tick as number));
      } catch (error) {
        if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable', { variant: 'image' });
        throw error;
      }
    });

    router.post('/api/grading/clock', async (ctx) => {
      const body = await readJson(ctx);
      const worldId = body.world;
      const tick = body.tick;
      if (typeof worldId !== 'string') throw new ApiError('bad_request');
      const found = await query('SELECT id FROM worlds WHERE id = $1', [worldId]);
      if (found.rowCount === 0) throw new ApiError('not_found');
      if (!Number.isInteger(tick) || (tick as number) < 0) throw new ApiError('bad_request');
      await query('UPDATE worlds SET tick = $2, base_tick = $2, frozen = true WHERE id = $1', [worldId, tick]);
      sendJson(ctx, 200, { world: worldId, tick });
    });
  }
}

function stripIds<T extends { host_id?: string; guest_id?: string | null }>(value: T): Omit<T, 'host_id' | 'guest_id'> {
  const { host_id: _host, guest_id: _guest, ...rest } = value;
  return rest;
}

async function applyLike(me: PlayerRow, photoId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
  if (!isUuid(photoId)) throw new ApiError('not_found');
  const target = await likeablePhoto(photoId, me.id);
  const likes = await setLike(photoId, me.id, liked);
  await publish({ query }, me.world_id, null, 'like', {
    photo: photoId,
    likes,
    liked,
    visitor_name: me.name,
    visitor_id: me.id,
    owner_id: target.ownerId,
    creature: target.creature,
  });
  return { likes, liked };
}

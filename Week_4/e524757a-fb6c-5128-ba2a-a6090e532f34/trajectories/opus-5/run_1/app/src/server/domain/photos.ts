import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { islandName, isLand, type Heading } from '../../shared/islands.js';
import { creatureById } from '../../shared/creatures.js';
import { framedCreatures } from '../../shared/frame.js';
import { creatureFacing, scorePhoto, type Score } from '../../shared/score.js';
import { config } from '../config.js';
import { query, transaction } from '../db.js';
import { putPhoto } from '../storage.js';
import { applyPhotoToAlbum, PAGE_REWARD_FRAMES, stampCount } from './albums.js';
import { filmCount, recordFilmChange } from './film.js';
import { creaturesAt, worldTick } from './world.js';
import { publish } from '../live.js';
import type { PlayerRow } from './players.js';

export type Pose = {
  island: number;
  tile: [number, number];
  camera: [number, number];
  heading: Heading;
  zoom: number;
  focus: number;
  tick: number;
};

export const PHOTO_ZOOMS = [1, 2, 4];
export const PHOTO_FOCUSES = [2, 4, 8, 16];

export type PhotoAnswer = {
  id: string;
  creature: string;
  creature_name: string;
  island: number;
  tick: number;
  score: Score;
  image_url: string;
};

export type PhotoRow = {
  id: string;
  player_id: string;
  creature_id: string;
  island: number;
  tick: string;
  total: number;
  size: number;
  centring: number;
  facing: number;
  sharpness: number;
};

export function photoAnswer(row: PhotoRow): PhotoAnswer {
  const creature = creatureById(row.creature_id);
  return {
    id: row.id,
    creature: row.creature_id,
    creature_name: creature ? creature.name : row.creature_id,
    island: row.island,
    tick: Number(row.tick),
    score: {
      size: row.size,
      centring: row.centring,
      facing: row.facing,
      sharpness: row.sharpness,
      total: row.total,
    },
    image_url: `/api/photos/${row.id}/image`,
  };
}

export function parsePose(raw: unknown): Pose {
  if (typeof raw !== 'string') throw new ApiError('bad_pose');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError('bad_pose');
  }
  if (value === null || typeof value !== 'object') throw new ApiError('bad_pose');
  const pose = value as Record<string, unknown>;
  const pair = (input: unknown): [number, number] => {
    if (!Array.isArray(input) || input.length !== 2) throw new ApiError('bad_pose');
    const [x, y] = input;
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new ApiError('bad_pose');
    return [x as number, y as number];
  };
  const island = pose.island;
  if (!Number.isInteger(island) || (island as number) < 1 || (island as number) > 5) throw new ApiError('bad_pose');
  const heading = pose.heading;
  if (heading !== 'N' && heading !== 'E' && heading !== 'S' && heading !== 'W') throw new ApiError('bad_pose');
  const zoom = pose.zoom;
  if (!Number.isInteger(zoom) || !PHOTO_ZOOMS.includes(zoom as number)) throw new ApiError('bad_pose');
  const focus = pose.focus;
  if (!Number.isInteger(focus) || !PHOTO_FOCUSES.includes(focus as number)) throw new ApiError('bad_pose');
  const tick = pose.tick;
  if (!Number.isInteger(tick) || (tick as number) < 0) throw new ApiError('bad_pose');
  return {
    island: island as number,
    tile: pair(pose.tile),
    camera: pair(pose.camera),
    heading,
    zoom: zoom as number,
    focus: focus as number,
    tick: tick as number,
  };
}

export function imageContentType(body: Buffer): 'image/png' | 'image/jpeg' | null {
  if (body.byteLength >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (body.byteLength >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  return null;
}

export function poseFingerprint(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** The published photo refusal order, checked after the size, type, film and key checks. */
export function subjectFor(pose: Pose, serverTick: number) {
  if (serverTick - pose.tick > config.photoTickGrace) throw new ApiError('tick_passed');
  if (pose.tick > serverTick) throw new ApiError('tick_ahead');
  if (!isLand(pose.island, pose.tile[0], pose.tile[1])) throw new ApiError('cannot_stand');
  if (Math.abs(pose.camera[0] - pose.tile[0]) > 1 || Math.abs(pose.camera[1] - pose.tile[1]) > 1)
    throw new ApiError('camera_too_far');
  const standing = creaturesAt(pose.tick).filter((creature) => creature.island === pose.island);
  const framed = framedCreatures({ x: pose.tile[0], y: pose.tile[1] }, pose.heading, pose.zoom, standing);
  const first = framed[0];
  if (!first) throw new ApiError('nothing_in_frame');
  return first;
}

export type KeptPhoto = {
  photo: PhotoAnswer;
  measures: {
    distance: number;
    best_distance: number;
    offset: number;
    focus_error: number;
    creature_facing: string;
  };
  album: { page_filled: boolean; pages_filled: number; stamp_earned: boolean };
  film: number;
};

export async function keepPhoto(player: PlayerRow, pose: Pose, image: Buffer, contentType: string): Promise<KeptPhoto> {
  const serverTick = await worldTick(player.world_id);
  const framed = subjectFor(pose, serverTick);
  const creature = creatureById(framed.creature.id)!;
  const facing = creatureFacing(pose.heading, framed.creature.heading);
  const score = scorePhoto({
    vector: framed.vector,
    zoom: pose.zoom,
    focus: pose.focus,
    creatureSize: creature.size,
    facing,
  });
  const id = randomUUID();
  const key = `photos/${id}.${contentType === 'image/jpeg' ? 'jpg' : 'png'}`;

  return transaction(async (db) => {
    await db.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [player.id]);
    const film = await filmCount(db, player.id);
    if (film <= 0) throw new ApiError('out_of_film');

    await putPhoto(key, image, contentType);

    await db.query(
      `INSERT INTO photos (id, player_id, world_id, creature_id, island, tick, total, size, centring, facing, sharpness, measures, image_key, content_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        player.id,
        player.world_id,
        creature.id,
        pose.island,
        pose.tick,
        score.total,
        score.size,
        score.centring,
        score.facing,
        score.sharpness,
        JSON.stringify({
          distance: framed.vector.forward,
          best_distance: 2 * pose.zoom * creature.size,
          offset: Math.abs(framed.vector.lateral),
          focus_error: Math.abs(pose.focus - framed.vector.forward),
          creature_facing: facing,
        }),
        key,
        contentType,
      ],
    );
    await recordFilmChange(db, player.id, -1, 'photo');
    const change = await applyPhotoToAlbum(db, player.id, pose.island, creature.id, id, score.total);
    if (change.pageFilled) await recordFilmChange(db, player.id, PAGE_REWARD_FRAMES, 'page');
    const stamps = await stampCount(db, player.id);
    const filmLeft = await filmCount(db, player.id);

    const answer: KeptPhoto = {
      photo: {
        id,
        creature: creature.id,
        creature_name: creature.name,
        island: pose.island,
        tick: pose.tick,
        score,
        image_url: `/api/photos/${id}/image`,
      },
      measures: {
        distance: framed.vector.forward,
        best_distance: 2 * pose.zoom * creature.size,
        offset: Math.abs(framed.vector.lateral),
        focus_error: Math.abs(pose.focus - framed.vector.forward),
        creature_facing: facing,
      },
      album: { page_filled: change.pageFilled, pages_filled: change.pagesFilled, stamp_earned: change.stampEarned },
      film: filmLeft,
    };

    await publish(db, player.world_id, player.id, 'progress', {
      photo: answer.photo,
      album: answer.album,
      film: filmLeft,
      stamps,
      lighthouse: stamps >= 3 ? 'open' : 'closed',
      island: pose.island,
      island_name: islandName(pose.island),
    });

    const safari = await db.query<{ code: string; guest_id: string | null }>(
      "SELECT code, guest_id FROM safaris WHERE host_id = $1 AND status = 'joined'",
      [player.id],
    );
    const seat = safari.rows[0];
    if (seat?.guest_id) {
      await publish(db, player.world_id, seat.guest_id, 'safari_photo', {
        host_name: player.name,
        creature_name: creature.name,
        total: score.total,
        image_url: answer.photo.image_url,
      });
    }
    return answer;
  });
}

export async function photoById(id: string): Promise<(PhotoRow & { image_key: string; content_type: string; world_id: string }) | null> {
  const found = await query<PhotoRow & { image_key: string; content_type: string; world_id: string }>(
    'SELECT * FROM photos WHERE id = $1',
    [id],
  );
  return found.rows[0] ?? null;
}

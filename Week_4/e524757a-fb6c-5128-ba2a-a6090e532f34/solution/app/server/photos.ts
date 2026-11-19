/** Taking, keeping and showing photos. A photo is kept only after MinIO confirms the object; the photo row, its score,
 *  the album change and the paired film rows then commit together, or none of them do. */
import { randomUUID } from 'node:crypto'
import { config } from './config'
import { type Db, one, pool, rows, transaction } from './db'
import { ApiError } from './errors'
import { type Context, route } from './http'
import { publish } from './live'
import { readAlbums, PAGE_TOTAL } from './albums'
import { changeFilm, filmOf } from './film'
import type { PlayerRow } from './players'
import { feedSeatedGuest } from './safaris'
import { scorePhoto } from './score'
import { inTurn } from './turns'
import { StorageError, deleteObject, getObject, putObject } from './s3'
import { isHeading, isInteger, isIslandId, isText, readTile, stable } from './validate'
import { creaturesAt, readTick } from './world'
import { creatureById, creaturesOfIsland, isLand, islandById, type Heading, type Tile } from '../shared/island'
import type { Photo, PhotoAnswer } from '../shared/types'

const PAGE_REWARD = 6
const ZOOMS = [1, 2, 4]
const FOCUSES = [2, 4, 8, 16]
const WHOLE_REQUEST_EXTRA = 64000

export interface PhotoRow {
  id: string
  player_id: string
  creature_id: string
  island: number
  tick: number
  size: number
  centring: number
  facing: number
  sharpness: number
  total: number
  image_key: string
}

export const PHOTO_COLUMNS = 'p.id, p.player_id, p.creature_id, p.island, p.tick, p.size, p.centring, p.facing, p.sharpness, p.total, p.image_key'

export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    creature: row.creature_id,
    creature_name: (creatureById(row.creature_id) as NonNullable<ReturnType<typeof creatureById>>).name,
    island: row.island,
    tick: row.tick,
    score: { size: row.size, centring: row.centring, facing: row.facing, sharpness: row.sharpness, total: row.total },
    image_url: `/api/photos/${row.id}/image`,
  }
}

/** A photo this viewer may see: their own, or one shown in a public hall, on a board, on a postcard, or fed to the seated safari guest. */
async function visiblePhoto(db: Db, photoId: string, viewerId: string | null): Promise<PhotoRow> {
  const row = await one<PhotoRow>(
    db,
    `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1 AND (
       p.player_id = $2
       OR EXISTS (SELECT 1 FROM hall_frames f JOIN players o ON o.id = f.player_id WHERE f.photo_id = p.id AND o.hall_public)
       OR EXISTS (SELECT 1 FROM board_entries b WHERE b.photo_id = p.id)
       OR EXISTS (SELECT 1 FROM postcards c WHERE c.photo_id = p.id)
       OR EXISTS (SELECT 1 FROM safari_photos sp JOIN safaris s ON s.id = sp.safari_id WHERE sp.photo_id = p.id AND s.guest_id = $2 AND s.status = 'joined'))`,
    [photoId, viewerId],
  )
  if (!row) throw new ApiError('not_found')
  return row
}

/** A photo of this player's own. */
export async function ownPhoto(db: Db, photoId: unknown, playerId: string): Promise<PhotoRow> {
  const row = isText(photoId) ? await one<PhotoRow>(db, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1 AND p.player_id = $2`, [photoId, playerId]) : undefined
  if (!row) throw new ApiError('not_found')
  return row
}

export async function readStoredImage(row: PhotoRow, variant: 'photo' | 'postcard' | 'image'): Promise<Buffer> {
  try {
    return await getObject(row.image_key)
  } catch (error) {
    if (error instanceof StorageError) throw new ApiError('storage_unavailable', variant)
    throw error
  }
}

interface ParsedPose { island: number; tile: Tile; camera: [number, number]; heading: Heading; zoom: number; focus: number; tick: number }

function readPose(raw: unknown): ParsedPose | null {
  if (typeof raw !== 'object' || raw === null) return null
  const pose = raw as Record<string, unknown>
  const tile = readTile(pose.tile)
  const camera = Array.isArray(pose.camera) && pose.camera.length === 2 && pose.camera.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (pose.camera as [number, number]) : null
  if (!isIslandId(pose.island) || !tile || !camera || !isHeading(pose.heading) || !ZOOMS.includes(pose.zoom as number) || !FOCUSES.includes(pose.focus as number) || !isInteger(pose.tick) || pose.tick < 0) return null
  return { island: pose.island, tile, camera, heading: pose.heading, zoom: pose.zoom as number, focus: pose.focus as number, tick: pose.tick }
}

function readSignature(image: Buffer): { type: string; extension: string } | null {
  if (image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', extension: 'png' }
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return { type: 'image/jpeg', extension: 'jpg' }
  return null
}

async function receive(c: Context): Promise<{ image: Buffer | null; pose: unknown }> {
  const raw = await c.raw(config.photoMaxBytes + WHOLE_REQUEST_EXTRA, 'photo_too_large')
  let form: FormData
  try {
    form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': String(c.req.headers['content-type']) }, body: new Uint8Array(raw) }).formData()
  } catch {
    throw new ApiError('bad_request')
  }
  const image = form.get('image')
  const pose = form.get('pose')
  let parsed: unknown = null
  try {
    parsed = typeof pose === 'string' ? JSON.parse(pose) : null
  } catch {
    parsed = null
  }
  return { image: image instanceof File ? Buffer.from(await image.arrayBuffer()) : null, pose: parsed }
}

async function keep(me: PlayerRow, pose: ParsedPose, image: Buffer, kind: { type: string; extension: string }, shotKey: string | null): Promise<{ answer: PhotoAnswer; guest: string | null }> {
  const present = creaturesAt(pose.tick).filter((creature) => creature.island === pose.island)
  const scored = scorePhoto({ tile: pose.tile, heading: pose.heading, zoom: pose.zoom, focus: pose.focus }, present)
  if (!scored) throw new ApiError('nothing_in_frame')
  const id = randomUUID()
  const imageKey = `photos/${id}.${kind.extension}`
  let stored = false
  try {
    return await transaction(async (client) => {
      await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [me.id])
      if ((await filmOf(client, me.id)) < 1) throw new ApiError('out_of_film')
      try {
        await putObject(imageKey, image, kind.type)
      } catch (error) {
        if (error instanceof StorageError) throw new ApiError('storage_unavailable', 'photo')
        throw error
      }
      stored = true
      const { score, measures, creature } = scored
      await client.query(
        `INSERT INTO photos (id, player_id, creature_id, island, tick, size, centring, facing, sharpness, total, measures, pose, shot_key, image_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, me.id, creature.id, pose.island, pose.tick, score.size, score.centring, score.facing, score.sharpness, score.total, measures, pose, shotKey, imageKey],
      )
      await changeFilm(client, me.id, -1, 'photo')
      const existing = await one<{ total: number }>(client, 'SELECT p.total FROM album_pages a JOIN photos p ON p.id = a.photo_id WHERE a.player_id = $1 AND a.creature_id = $2', [me.id, creature.id])
      const pageFilled = score.total >= PAGE_TOTAL && !existing
      if (pageFilled) {
        await client.query('INSERT INTO album_pages (player_id, creature_id, photo_id) VALUES ($1, $2, $3)', [me.id, creature.id, id])
        await changeFilm(client, me.id, PAGE_REWARD, 'page')
      } else if (existing && score.total > existing.total) {
        await client.query('UPDATE album_pages SET photo_id = $3 WHERE player_id = $1 AND creature_id = $2', [me.id, creature.id, id])
      }
      const [counted] = await rows<{ n: number }>(client, 'SELECT COUNT(*)::int AS n FROM album_pages WHERE player_id = $1 AND creature_id = ANY($2)', [me.id, creaturesOfIsland(pose.island).map((c) => c.id)])
      const pagesFilled = (counted as { n: number }).n
      const stampEarned = pagesFilled === creaturesOfIsland(pose.island).length && (await client.query('INSERT INTO stamps (player_id, island) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, pose.island])).rowCount === 1
      const answer: PhotoAnswer = {
        photo: {
          id, creature: creature.id, creature_name: creature.name, island: pose.island, tick: pose.tick, score, measures,
          album: { page_filled: pageFilled, pages_filled: pagesFilled, stamp_earned: stampEarned },
          film: await filmOf(client, me.id), image_url: `/api/photos/${id}/image`,
        },
      }
      await client.query('UPDATE photos SET answer = $2 WHERE id = $1', [id, answer])
      return { answer, guest: await feedSeatedGuest(client, me.id, id) }
    })
  } catch (error) {
    if (stored) await deleteObject(imageKey).catch(() => undefined)
    throw error
  }
}

route('POST', '/api/photos', 'required', async (c) => {
  const me = c.player as PlayerRow
  const { image, pose: rawPose } = await receive(c)
  const shotKey = isText(c.req.headers['shot-key']) && c.req.headers['shot-key'] !== '' ? (c.req.headers['shot-key'] as string) : null
  const pose = readPose(rawPose)
  const run = async (): Promise<{ answer: PhotoAnswer; guest: string | null } | { replay: PhotoAnswer }> => {
    let keyUsed = false
    if (shotKey) {
      const used = await one<{ answer: PhotoAnswer; pose: unknown }>(pool, 'SELECT answer, pose FROM photos WHERE player_id = $1 AND shot_key = $2', [me.id, shotKey])
      if (used) {
        if (pose && stable(pose) === stable(used.pose)) return { replay: used.answer }
        keyUsed = true
      }
    }
    if (image && image.length > config.photoMaxBytes) throw new ApiError('photo_too_large', String(config.photoMaxBytes))
    const kind = image ? readSignature(image) : null
    if (!image || !kind) throw new ApiError('not_an_image')
    if ((await filmOf(pool, me.id)) < 1) throw new ApiError('out_of_film')
    if (keyUsed) throw new ApiError('shot_key_reused')
    if (!pose) throw new ApiError('bad_pose')
    const serverTick = await readTick(pool, me.world_id)
    if (pose.tick < serverTick - config.photoTickGrace) throw new ApiError('tick_passed')
    if (pose.tick > serverTick) throw new ApiError('tick_ahead')
    if (!isLand(islandById(pose.island) as NonNullable<ReturnType<typeof islandById>>, pose.tile[0], pose.tile[1])) throw new ApiError('cannot_stand')
    if (Math.abs(pose.camera[0] - pose.tile[0]) > 1 || Math.abs(pose.camera[1] - pose.tile[1]) > 1) throw new ApiError('camera_too_far')
    return keep(me, pose, image, kind, shotKey)
  }
  const result = await (shotKey ? inTurn(`${me.id}:${shotKey}`, run) : run())
  if ('replay' in result) return { status: 201, body: result.replay }
  const { answer, guest } = result
  await publish(pool, { players: [me.id] }, 'progress', await readAlbums(pool, me.id))
  if (guest) {
    const { measures: _m, album: _a, film: _f, ...photo } = answer.photo
    await publish(pool, { players: [guest] }, 'safari_photo', { host_name: me.name, photo })
  }
  return { status: 201, body: answer }
})

route('GET', '/api/me/photos', 'required', async (c) => {
  const found = await rows<PhotoRow>(pool, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.player_id = $1 ORDER BY p.created_at DESC`, [(c.player as PlayerRow).id])
  return { status: 200, body: { photos: found.map(toPhoto) } }
})

route('GET', '/api/photos/:id', 'required', async (c) => ({ status: 200, body: { photo: toPhoto(await visiblePhoto(pool, c.params[0] as string, (c.player as PlayerRow).id)) } }))

route('GET', '/api/photos/:id/image', 'optional', async (c) => {
  const row = await visiblePhoto(pool, c.params[0] as string, c.player?.id ?? null)
  const data = await readStoredImage(row, 'image')
  return { status: 200, bytes: { data, type: row.image_key.endsWith('.png') ? 'image/png' : 'image/jpeg' } }
})

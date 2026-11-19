/** Gallery halls and their likes. A private hall answers 404 for everyone but its owner. */
import { type Db, one, pool, rows, transaction } from './db'
import { ApiError } from './errors'
import { type Context, route } from './http'
import { publish } from './live'
import { PHOTO_COLUMNS, type PhotoRow, ownPhoto, toPhoto } from './photos'
import type { PlayerRow } from './players'
import { isText, lengthOf } from './validate'
import type { HallFrame, OwnHall, PublicHall } from '../shared/types'

const HALL_SIZE = 12
const CAPTION_LIMIT = 140

interface FrameRow extends PhotoRow { frame: number; caption: string; likes: number; liked_by_me: boolean }

async function framesOf(db: Db, ownerId: string, viewerId: string | null): Promise<HallFrame[]> {
  const found = await rows<FrameRow>(
    db,
    `SELECT f.frame, f.caption, ${PHOTO_COLUMNS},
            (SELECT COUNT(*)::int FROM likes l WHERE l.photo_id = p.id) AS likes,
            EXISTS (SELECT 1 FROM likes l WHERE l.photo_id = p.id AND l.visitor_id = $2) AS liked_by_me
     FROM hall_frames f JOIN photos p ON p.id = f.photo_id WHERE f.player_id = $1 ORDER BY f.frame`,
    [ownerId, viewerId],
  )
  return found.map((row) => ({ frame: row.frame, caption: row.caption, photo: toPhoto(row), likes: row.likes, liked_by_me: row.liked_by_me }))
}

async function ownHall(db: Db, me: PlayerRow): Promise<OwnHall> {
  const hall = (await one<{ hall_public: boolean }>(db, 'SELECT hall_public FROM players WHERE id = $1', [me.id])) as { hall_public: boolean }
  const frames = (await framesOf(db, me.id, null)).map(({ liked_by_me: _liked, ...frame }) => frame)
  return { handle: me.handle, public: hall.hall_public, frames }
}

route('GET', '/api/me/hall', 'required', async (c) => ({ status: 200, body: { hall: await ownHall(pool, c.player as PlayerRow) } }))

route('PUT', '/api/me/hall', 'required', async (c) => {
  const me = c.player as PlayerRow
  const body = await c.json()
  if (body.public !== undefined && typeof body.public !== 'boolean') throw new ApiError('bad_request')
  let wanted: { photo: string; caption: string }[] | null = null
  if (body.frames !== undefined) {
    if (!Array.isArray(body.frames)) throw new ApiError('bad_request')
    wanted = []
    for (const item of body.frames as Record<string, unknown>[]) {
      if (typeof item !== 'object' || item === null || (item.caption !== undefined && !isText(item.caption))) throw new ApiError('bad_request')
      wanted.push({ photo: (await ownPhoto(pool, item.photo, me.id)).id, caption: (item.caption as string | undefined) ?? '' })
    }
    if (new Set(wanted.map((w) => w.photo)).size !== wanted.length) throw new ApiError('bad_request')
    if (wanted.length > HALL_SIZE) throw new ApiError('hall_full')
    if (wanted.some((w) => lengthOf(w.caption) > CAPTION_LIMIT)) throw new ApiError('caption_too_long')
  }
  await transaction(async (client) => {
    if (body.public !== undefined) await client.query('UPDATE players SET hall_public = $2 WHERE id = $1', [me.id, body.public])
    if (wanted) {
      await client.query('DELETE FROM hall_frames WHERE player_id = $1', [me.id])
      for (const [index, item] of wanted.entries()) await client.query('INSERT INTO hall_frames (player_id, photo_id, frame, caption) VALUES ($1, $2, $3, $4)', [me.id, item.photo, index + 1, item.caption])
    }
  })
  return { status: 200, body: { hall: await ownHall(pool, me) } }
})

route('GET', '/api/halls/:handle', 'optional', async (c) => {
  const owner = await one<{ id: string; name: string; hall_public: boolean }>(pool, 'SELECT id, name, hall_public FROM players WHERE handle = $1', [c.params[0]])
  if (!owner || (!owner.hall_public && owner.id !== c.player?.id)) throw new ApiError('not_found')
  const hall: PublicHall = { handle: c.params[0] as string, owner_name: owner.name, frames: await framesOf(pool, owner.id, c.player?.id ?? null) }
  return { status: 200, body: { hall } }
})

async function setLike(c: Context, liked: boolean) {
  const me = c.player as PlayerRow
  const hung = await one<{ owner_id: string; handle: string }>(
    pool,
    `SELECT o.id AS owner_id, o.handle FROM hall_frames f JOIN players o ON o.id = f.player_id WHERE f.photo_id = $1 AND (o.hall_public OR o.id = $2)`,
    [c.params[0], me.id],
  )
  if (!hung) throw new ApiError('not_found')
  if (hung.owner_id === me.id) throw new ApiError('own_photo')
  const photoId = c.params[0] as string
  const changed = liked
    ? (await pool.query('INSERT INTO likes (photo_id, visitor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [photoId, me.id])).rowCount === 1
    : (await pool.query('DELETE FROM likes WHERE photo_id = $1 AND visitor_id = $2', [photoId, me.id])).rowCount === 1
  const counted = (await one<{ likes: number }>(pool, 'SELECT COUNT(*)::int AS likes FROM likes WHERE photo_id = $1', [photoId])) as { likes: number }
  if (changed) {
    const photo = toPhoto((await one<PhotoRow>(pool, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1`, [photoId])) as PhotoRow)
    await publish(pool, { players: [hung.owner_id, me.id], hall: hung.handle }, 'like', { photo: photoId, creature_name: photo.creature_name, likes: counted.likes, visitor: me.id, visitor_name: me.name, liked })
  }
  return { status: 200, body: { likes: counted.likes, liked } }
}

route('PUT', '/api/photos/:id/like', 'required', (c) => setLike(c, true))
route('DELETE', '/api/photos/:id/like', 'required', (c) => setLike(c, false))

/** Grading routes, present only when GRADING_ROUTES=on: a fresh isolated world with seeded people, and its frozen clock. */
import { randomBytes, randomUUID } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { one, pool, transaction } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { announceClock } from './live'
import { changeFilm } from './film'
import { type PlayerRow, createPlayer } from './players'
import { MAX_CENTRING, MAX_FACING, MAX_SIZE } from './score'
import { newCode } from './safaris'
import { putObject, StorageError } from './s3'
import { isInteger, isText } from './validate'

const DEFAULT_TICK = 6000

function chunk(kind: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(kind), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  head.copy(out, 4)
  out.writeUInt32BE(crc32(head), 8 + data.length)
  return out
}

/** A small PNG per seeded photo: its colour as a lit diagonal wash with a darker subject at the centre, never a flat field. */
function solidPng(red: number, green: number, blue: number): Buffer {
  const size = 16
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const pixel = (x: number, y: number): number[] => {
    const light = 1.25 - (x + y) / (4 * (size - 1))
    const subject = Math.hypot(x - 7.5, y - 8.5) < 4 ? 0.55 : 1
    return [red, green, blue].map((channel) => Math.min(255, Math.round(channel * light * subject)))
  }
  const rows = Array.from({ length: size }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, (_, x) => pixel(x, y)).flat())]))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

interface SeedPhoto { key: string; owner: string; creature: string; total: number; tick: number; colour: [number, number, number] }

const PHOTOS: SeedPhoto[] = [
  { key: 'heron', owner: 'explorer', creature: 'reedpipe-heron', total: 74, tick: 5200, colour: [120, 150, 190] },
  { key: 'moth', owner: 'explorer', creature: 'gloamfin-moth', total: 81, tick: 5300, colour: [190, 150, 110] },
  { key: 'lark', owner: 'explorer', creature: 'puddle-lark', total: 66, tick: 5400, colour: [110, 170, 130] },
  { key: 'friend_heron', owner: 'friend', creature: 'reedpipe-heron', total: 74, tick: 5100, colour: [100, 140, 180] },
  { key: 'rival_lark', owner: 'rival', creature: 'puddle-lark', total: 66, tick: 5300, colour: [130, 160, 120] },
  { key: 'rival_private', owner: 'rival', creature: 'mossback-newt', total: 55, tick: 5000, colour: [90, 130, 100] },
]

const PEOPLE: { key: string; name: string; confirmed?: boolean; ranger?: boolean }[] = [
  { key: 'explorer', name: 'Ada Explorer' },
  { key: 'friend', name: 'Finn Friend' },
  { key: 'rival', name: 'Rhea Rival' },
  { key: 'ranger', name: 'Sal Ranger', ranger: true },
  { key: 'ranger2', name: 'Una Ranger', ranger: true },
  { key: 'newcomer', name: 'Nia Newcomer', confirmed: false },
]

/** Splits a seeded total across the four rows, within each row's own maximum. */
function rowsOf(total: number): [number, number, number, number] {
  const size = Math.min(MAX_SIZE, total)
  const centring = Math.min(MAX_CENTRING, total - size)
  const facing = Math.min(MAX_FACING, total - size - centring)
  return [size, centring, facing, total - size - centring - facing]
}

route('POST', '/api/grading/world', 'none', async (c) => {
  const body = await c.json()
  const tick = body.tick === undefined ? DEFAULT_TICK : body.tick
  if (!isInteger(tick) || tick < 0) throw new ApiError('bad_request')
  const ids = new Map(PHOTOS.map((photo) => [photo.key, randomUUID()]))
  try {
    await Promise.all(PHOTOS.map((photo) => putObject(`photos/${ids.get(photo.key)}.png`, solidPng(...photo.colour), 'image/png')))
  } catch (error) {
    if (error instanceof StorageError) throw new ApiError('storage_unavailable', 'image')
    throw error
  }
  const token = randomBytes(4).toString('hex')
  const answer = await transaction(async (client) => {
    const world = (await one<{ id: string }>(client, `INSERT INTO worlds (kind, frozen, tick) VALUES ('grading', true, $1) RETURNING id`, [tick])) as { id: string }
    const players = new Map<string, { row: PlayerRow; email: string; password: string }>()
    for (const person of PEOPLE) {
      const email = `${person.key}-${token}@example.test`
      const password = `Tide-${randomBytes(6).toString('hex')}`
      const row = await createPlayer(client, {
        worldId: world.id, name: `${person.name} ${token}`, email, password,
        confirmed: person.confirmed ?? true, ranger: person.ranger ?? false, hallPublic: person.key === 'explorer',
      })
      players.set(person.key, { row, email, password })
    }
    const id = (key: string): string => (players.get(key) as { row: PlayerRow }).row.id
    for (const photo of PHOTOS) {
      const [size, centring, facing, sharpness] = rowsOf(photo.total)
      await client.query(
        `INSERT INTO photos (id, player_id, creature_id, island, tick, size, centring, facing, sharpness, total, image_key) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)`,
        [ids.get(photo.key), id(photo.owner), photo.creature, photo.tick, size, centring, facing, sharpness, photo.total, `photos/${ids.get(photo.key)}.png`],
      )
    }
    const photoId = (key: string): string => ids.get(key) as string
    await changeFilm(client, id('explorer'), -6, 'photo')
    for (const key of ['heron', 'moth', 'lark']) {
      const creature = (PHOTOS.find((p) => p.key === key) as SeedPhoto).creature
      await client.query('INSERT INTO album_pages (player_id, creature_id, photo_id) VALUES ($1, $2, $3)', [id('explorer'), creature, photoId(key)])
    }
    await client.query('INSERT INTO stamps (player_id, island) VALUES ($1, 2), ($1, 3)', [id('explorer')])
    for (const [frame, key] of ['heron', 'moth', 'lark'].entries()) {
      await client.query('INSERT INTO hall_frames (player_id, photo_id, frame) VALUES ($1, $2, $3)', [id('explorer'), photoId(key), frame + 1])
    }
    await client.query('INSERT INTO hall_frames (player_id, photo_id, frame) VALUES ($1, $2, 1)', [id('rival'), photoId('rival_private')])
    await client.query('INSERT INTO board_entries (island, player_id, photo_id) VALUES (1, $1, $2)', [id('rival'), photoId('rival_lark')])
    const approved = (await one<{ id: string }>(client, `INSERT INTO notes (world_id, author_id, text, status, decided_by) VALUES ($1, $2, 'Fresh water at the harbour tap.', 'approved', $3) RETURNING id`, [world.id, id('explorer'), id('ranger')])) as { id: string }
    const pending = (await one<{ id: string }>(client, `INSERT INTO notes (world_id, author_id, text) VALUES ($1, $2, 'Seal pups on the dock at low tide.') RETURNING id`, [world.id, id('friend')])) as { id: string }
    const code = newCode()
    const safari = (await one<{ id: string }>(client, `INSERT INTO safaris (world_id, code, host_id) VALUES ($1, $2, $3) RETURNING id`, [world.id, code, id('explorer')])) as { id: string }
    await client.query('INSERT INTO sightings (safari_id, island, x, y, by_id) VALUES ($1, 1, 12, 6, $2)', [safari.id, id('explorer')])
    const who = (key: string): Record<string, string> => {
      const { row, email, password } = players.get(key) as { row: PlayerRow; email: string; password: string }
      return { id: row.id, name: row.name, handle: row.handle, email, password }
    }
    return {
      world: { id: world.id, tick },
      ...Object.fromEntries(PEOPLE.map((person) => [person.key, who(person.key)])),
      photos: Object.fromEntries(PHOTOS.map((photo) => [photo.key, photoId(photo.key)])),
      safari: { code },
      notes: { pending: pending.id, approved: approved.id },
    }
  })
  return { status: 201, body: answer }
})

route('POST', '/api/grading/clock', 'none', async (c) => {
  const body = await c.json()
  const moved = isText(body.world) && isInteger(body.tick) && body.tick >= 0
    ? await one(pool, `UPDATE worlds SET tick = $2 WHERE id = $1 AND frozen RETURNING id`, [body.world, body.tick])
    : undefined
  if (!moved) {
    const known = isText(body.world) && (await one(pool, 'SELECT 1 FROM worlds WHERE id = $1 AND frozen', [body.world]))
    throw new ApiError(known ? 'bad_request' : 'not_found')
  }
  await announceClock()
  return { status: 200, body: { world: body.world, tick: body.tick } }
})

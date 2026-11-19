/** Players, passwords and sessions. */
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SESSION_SECONDS, config } from './config'
import { type Db, one } from './db'
import { changeFilm } from './film'
import { FULL_ROLL } from '../shared/types'
import { ApiError } from './errors'
import type { Graphics, Player, Position, Settings } from '../shared/types'
import type { Heading } from '../shared/island'

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>

export interface PlayerRow {
  id: string
  world_id: string
  name: string
  handle: string
  email: string
  confirmed: boolean
  ranger: boolean
  island: number
  tile_x: number
  tile_y: number
  heading: Heading
  music: number
  effects: number
  graphics: Graphics
  hall_public: boolean
}

export const PLAYER_COLUMNS = 'id, world_id, name, handle, email, confirmed, ranger, island, tile_x, tile_y, heading, music, effects, graphics, hall_public'

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt, 32)).toString('hex')}`
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':') as [string, string]
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'))
}

export function toPlayer(row: PlayerRow, own: boolean): Player {
  const player: Player = { id: row.id, name: row.name, handle: row.handle, confirmed: row.confirmed, ranger: row.ranger }
  if (own) player.email = row.email
  return player
}

export const positionOf = (row: PlayerRow): Position => ({ island: row.island, tile: [row.tile_x, row.tile_y], heading: row.heading })
export const settingsOf = (row: PlayerRow): Settings => ({ music: row.music, effects: row.effects, graphics: row.graphics })

export function sixDigitCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

function handleFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  return `${slug || 'explorer'}-${randomBytes(3).toString('hex')}`
}

interface NewPlayer {
  worldId: string
  name: string
  email: string
  password: string
  confirmed?: boolean
  ranger?: boolean
  hallPublic?: boolean
  code?: string
}

/** Creates a player with their starting film (36 frames). */
export async function createPlayer(db: Db, input: NewPlayer): Promise<PlayerRow> {
  const id = randomUUID()
  const row = await one<PlayerRow>(
    db,
    `INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger, hall_public, confirm_code, confirm_code_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10::text IS NULL THEN NULL ELSE now() + make_interval(secs => $11) END)
     RETURNING ${PLAYER_COLUMNS}`,
    [id, input.worldId, input.name, handleFor(input.name), input.email, await hashPassword(input.password), input.confirmed ?? false, input.ranger ?? false,
      input.hallPublic ?? false, input.code ?? null, config.confirmCodeTtlSeconds],
  )
  await changeFilm(db, id, FULL_ROLL, 'start')
  return row as PlayerRow
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export async function openSession(db: Db, playerId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.query('INSERT INTO sessions (token_hash, player_id) VALUES ($1, $2)', [hashToken(token), playerId])
  return token
}

export async function playerOfToken(db: Db, token: string): Promise<PlayerRow | undefined> {
  return one<PlayerRow>(db, `SELECT ${PLAYER_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')} FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1 AND s.created_at > now() - make_interval(secs => $2)`, [hashToken(token), SESSION_SECONDS])
}

export async function playerOfCredentials(db: Db, email: string, password: string): Promise<PlayerRow> {
  const row = await one<PlayerRow & { password_hash: string }>(db, `SELECT ${PLAYER_COLUMNS}, password_hash FROM players WHERE lower(email) = lower($1)`, [email])
  if (!row || !(await passwordMatches(password, row.password_hash))) throw new ApiError('bad_credentials')
  return row
}

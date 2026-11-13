import { randomUUID } from 'node:crypto'
import type { Op, Settings } from '../shared/types.ts'
import { isDisplayName } from '../shared/limits.ts'
import { config } from './config.ts'
import { pool } from './db.ts'
import { ApiError, invalid } from './errors.ts'
import { changeLink, chooseTeam, createGame, gameJson, joinGame, requireGame, resolveCode, scoresOf, startRace } from './games.ts'
import { type Reply, cookieHeader } from './http.ts'
import type { Route } from './http.ts'
import { applyWrite, inProgress, presentIn, publish, revokeLink, teamChanged } from './hub.ts'
import { createUpload, listPuzzles, originalKey, parseFilters, puzzleJson, requireVisiblePuzzle } from './puzzles.ts'
import { flushRecords, historyEntries, readRecord } from './records.ts'
import { getObject, storageReachable } from './s3.ts'
import { seedGrading, startSession } from './grading.ts'

const SETTING_KEYS = ['skip_filled', 'jump_next_clue', 'autocheck'] as const

const ok = (body: unknown): Reply => ({ status: 200, body })

async function settingsOf(playerId: string): Promise<Settings> {
  const { rows } = await pool.query<Settings>('SELECT skip_filled, jump_next_clue, autocheck FROM players WHERE id = $1', [playerId])
  return rows[0]
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/health$/,
    needsPlayer: false,
    body: 'none',
    async handle() {
      const reachable = await storageReachable()
      if (reachable) void flushRecords()
      return ok({ status: reachable ? 'ok' : 'unavailable' })
    },
  },
  {
    method: 'GET',
    path: /^\/api\/config$/,
    needsPlayer: false,
    body: 'none',
    async handle() {
      return ok({
        heartbeat_ms: config.heartbeatMs,
        presence_grace_ms: config.presenceGraceMs,
        upload_max_bytes: config.uploadMaxBytes,
        max_grid: config.maxGrid,
        max_players: config.maxPlayers,
        live_rate: config.liveRate,
        toast_ms: config.toastMs,
        replay_step_ms: config.replayStepMs,
      })
    },
  },
  {
    method: 'POST',
    path: /^\/api\/players$/,
    needsPlayer: false,
    body: 'json',
    async handle({ json }) {
      const name = json().display_name
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (typeof name !== 'string' || !isDisplayName(trimmed)) throw invalid({ display_name: 'Enter a name between 1 and 24 characters.' })
      const id = randomUUID()
      await pool.query('INSERT INTO players (id, display_name) VALUES ($1, $2)', [id, trimmed])
      return { status: 201, body: { id, display_name: trimmed }, cookie: cookieHeader(id) }
    },
  },
  {
    method: 'GET',
    path: /^\/api\/players\/me$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player }) {
      return ok({ id: player.id, display_name: player.displayName })
    },
  },
  {
    method: 'GET',
    path: /^\/api\/players\/me\/settings$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player }) {
      return ok(await settingsOf(player.id))
    },
  },
  {
    method: 'PUT',
    path: /^\/api\/players\/me\/settings$/,
    needsPlayer: true,
    body: 'json',
    async handle({ player, json }) {
      const body = json()
      const bad = SETTING_KEYS.find((key) => typeof body[key] !== 'boolean')
      if (bad) throw invalid({ [bad]: 'Must be true or false.' })
      await pool.query('UPDATE players SET skip_filled = $2, jump_next_clue = $3, autocheck = $4 WHERE id = $1', [player.id, body.skip_filled, body.jump_next_clue, body.autocheck])
      return ok(await settingsOf(player.id))
    },
  },
  {
    method: 'GET',
    path: /^\/api\/puzzles$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, query }) {
      return ok({ puzzles: await listPuzzles(player.id, parseFilters(query), inProgress) })
    },
  },
  {
    method: 'POST',
    path: /^\/api\/puzzles$/,
    needsPlayer: true,
    body: 'upload',
    async handle({ player, body }) {
      void flushRecords()
      const { puzzle } = await createUpload(player.id, body)
      return { status: 201, body: { puzzle: puzzleJson(puzzle), solution: puzzle.solution } }
    },
  },
  {
    method: 'GET',
    path: /^\/api\/puzzles\/([^/]+)$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, params }) {
      return ok(puzzleJson(await requireVisiblePuzzle(params[0], player.id)))
    },
  },
  {
    method: 'GET',
    path: /^\/api\/puzzles\/([^/]+)\/original$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, params }) {
      const puzzle = await requireVisiblePuzzle(params[0], player.id)
      if (puzzle.source === 'library') throw new ApiError('not_found')
      void flushRecords()
      const bytes = await getObject(originalKey(puzzle.id))
      return { status: 200, raw: { bytes, type: 'text/plain; charset=utf-8', disposition: `attachment; filename="${puzzle.id}.overlap.txt"` } }
    },
  },
  {
    method: 'POST',
    path: /^\/api\/games$/,
    needsPlayer: true,
    body: 'json',
    async handle({ player, json }) {
      const id = await createGame(player.id, json())
      const { game, seat } = await requireGame(id, player.id)
      return { status: 201, body: await gameJson(pool, game, seat, presentIn(id)) }
    },
  },
  {
    method: 'GET',
    path: /^\/api\/games\/([^/]+)$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, params }) {
      const { game, seat } = await requireGame(params[0], player.id)
      return ok(await gameJson(pool, game, seat, presentIn(game.id)))
    },
  },
  {
    method: 'GET',
    path: /^\/api\/games\/([^/]+)\/ops$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, params }) {
      const { game } = await requireGame(params[0], player.id)
      const { rows } = await pool.query<{ op: Op }>('SELECT op FROM ops WHERE game_id = $1 ORDER BY seq', [game.id])
      return ok({ ops: rows.map((row) => row.op) })
    },
  },
  {
    method: 'POST',
    path: /^\/api\/games\/([^/]+)\/ops$/,
    needsPlayer: true,
    body: 'json',
    rated: true,
    async handle({ player, params, json }) {
      await requireGame(params[0], player.id)
      return ok(await applyWrite(params[0], player.id, json()))
    },
  },
  ...(['off', 'replace'] as const).map(
    (change): Route => ({
      method: 'POST',
      path: new RegExp(`^/api/games/([^/]+)/link/${change}$`),
      needsPlayer: true,
      body: 'json',
      async handle({ player, params }) {
        await changeLink(params[0], player.id, change)
        revokeLink(params[0], player.id, change === 'off' ? 'off' : 'replaced')
        const { game, seat } = await requireGame(params[0], player.id)
        return ok(await gameJson(pool, game, seat, presentIn(game.id)))
      },
    }),
  ),
  {
    method: 'POST',
    path: /^\/api\/games\/([^/]+)\/team$/,
    needsPlayer: true,
    body: 'json',
    async handle({ player, params, json }) {
      await teamChanged(params[0], player.id, await chooseTeam(params[0], player.id, json()))
      const { game, seat } = await requireGame(params[0], player.id)
      return ok(await gameJson(pool, game, seat, presentIn(game.id)))
    },
  },
  {
    method: 'POST',
    path: /^\/api\/games\/([^/]+)\/race\/start$/,
    needsPlayer: true,
    body: 'json',
    async handle({ player, params }) {
      await startRace(params[0], player.id)
      const { game, seat } = await requireGame(params[0], player.id)
      await publish(game.id, [{ message: { type: 'race', state: 'racing', scores: scoresOf(game) }, to: 'all' }])
      return ok(await gameJson(pool, game, seat, presentIn(game.id)))
    },
  },
  {
    method: 'GET',
    path: /^\/api\/links\/([^/]+)$/,
    needsPlayer: true,
    body: 'none',
    async handle({ params }) {
      const game = await resolveCode(params[0])
      return ok({ game_id: game.id, puzzle_title: game.puzzle.title, status: game.status, player_count: game.seats.length })
    },
  },
  {
    method: 'POST',
    path: /^\/api\/links\/([^/]+)\/join$/,
    needsPlayer: true,
    body: 'json',
    async handle({ player, params }) {
      const gameId = await joinGame(params[0], player.id)
      const { game, seat } = await requireGame(gameId, player.id)
      return ok(await gameJson(pool, game, seat, presentIn(game.id)))
    },
  },
  {
    method: 'GET',
    path: /^\/api\/history$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player }) {
      return ok({ entries: await historyEntries(player.id) })
    },
  },
  {
    method: 'GET',
    path: /^\/api\/history\/([^/]+)\/record$/,
    needsPlayer: true,
    body: 'none',
    async handle({ player, params }) {
      void flushRecords()
      return { status: 200, raw: { bytes: await readRecord(player.id, params[0]), type: 'application/json' } }
    },
  },
  ...(config.grading
    ? ([
        {
          method: 'POST',
          path: /^\/api\/grading\/seed$/,
          needsPlayer: false,
          body: 'json',
          async handle({ json }) {
            return { status: 201, body: await seedGrading(json()) }
          },
        },
        {
          method: 'POST',
          path: /^\/api\/grading\/session$/,
          needsPlayer: false,
          body: 'json',
          async handle({ json }) {
            return { status: 204, cookie: cookieHeader(await startSession(json())) }
          },
        },
      ] satisfies Route[])
    : []),
]


import { timingSafeEqual } from 'node:crypto'
import type { Colour, Repeat } from '../../shared/api.ts'
import { config, today } from '../config.ts'
import { hashPassword, newToken } from '../auth.ts'
import { one, pool, transaction, type Db } from '../db.ts'
import { type ChartData, blankGrid } from '../domain/chart.ts'
import { type Ctx, notFound, route } from '../http.ts'
import { holdUpdates } from '../live.ts'
import { sendMail } from '../mail.ts'
import { replaceChart, saveVersion, setColours } from '../store.ts'
import { counterSet } from '../valkey.ts'
import { object } from './accounts.ts'

const array = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(object) : [])
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const whole = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isInteger(value) ? value : fallback)

function guard(ctx: Ctx): void {
  const sent = Buffer.from(String(ctx.req.headers['x-grading-key'] ?? ''))
  const want = Buffer.from(config.gradingKey)
  if (!config.gradingKey || sent.length !== want.length || !timingSafeEqual(sent, want)) throw notFound()
}

function fill<T>(rowsOf: unknown, height: number, width: number, blank: T): T[][] {
  const grid = blankGrid(height, width, blank)
  for (const [row, line] of Object.entries(object(rowsOf))) {
    const r = Number(row) - 1
    if (r < 0 || r >= height || typeof line !== 'string') continue
    line.trim().split(/\s+/).slice(0, width).forEach((token, c) => { grid[r][c] = token as T })
  }
  return grid
}

function chartOf(spec: Record<string, unknown>, base: ChartData): ChartData {
  const height = whole(spec.height, base.height)
  const width = whole(spec.width, base.width)
  return {
    ...base, castOn: whole(spec.castOn, base.castOn), height, width,
    colours: Array.isArray(spec.colours) && spec.colours.length ? (spec.colours as Colour[]) : base.colours,
    repeats: Array.isArray(spec.repeats) ? (array(spec.repeats) as unknown as Repeat[]) : [],
    stitch: fill<string>(spec.rows, height, width, 'ns'), colour: fill<string>(spec.colourRows, height, width, 'A'),
  }
}

async function userId(db: Db, email: string): Promise<string> {
  const found = await one<{ id: string }>(db, 'SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
  if (!found) throw notFound()
  return found.id
}

route('POST', '/api/grading/setup', 'public', async (ctx) => {
  guard(ctx)
  const body = object(ctx.body())
  const users: Record<string, string> = {}
  for (const spec of array(body.users)) {
    const email = str(spec.email).toLowerCase()
    const hash = await hashPassword(str(spec.password))
    users[email] = (await pool.query(
      `INSERT INTO users (email, name, password_hash, verified) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = $2, password_hash = $3, verified = $4 RETURNING id`,
      [email, str(spec.name), hash, spec.verified !== false])).rows[0].id as string
  }
  const patterns: Record<string, string> = {}
  const invites: { token: string; email: string; name: string }[] = []
  for (const spec of array(body.patterns)) {
    const id = await transaction(async (db) => {
      const owner = await userId(db, str(spec.owner))
      const craft = str(spec.craft, 'knit') === 'crochet' ? 'crochet' : 'knit'
      const mode = str(spec.mode, 'flat') === 'round' ? 'round' : 'flat'
      const terms = craft === 'crochet' ? (spec.terms === 'uk' ? 'uk' : 'us') : null
      const base: ChartData = {
        craft, mode, terms, castOn: 1, width: 1, height: 1, colours: [{ letter: 'A', name: 'Main', hex: '#f1ede4' }],
        repeats: [], stitch: [], colour: [],
      }
      const chart = chartOf(spec, base)
      const patternId = (await db.query(
        `INSERT INTO patterns (owner_id, name, craft, mode, terms, cast_on, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [owner, str(spec.name), craft, mode, terms, chart.castOn, chart.width, chart.height])).rows[0].id as string
      await setColours(db, patternId, chart.colours)
      await replaceChart(db, patternId, chart, blankGrid(chart.height, chart.width, 0), null)
      for (const email of Array.isArray(spec.coDesigners) ? spec.coDesigners : []) {
        await db.query('INSERT INTO co_designers (pattern_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [patternId, await userId(db, str(email))])
      }
      let count = 0
      for (const version of array(spec.versions)) {
        await saveVersion(db, patternId, chartOf(version, { ...chart, repeats: [] }), str(version.note), today())
        count++
      }
      if (spec.published === true && count) await db.query('UPDATE patterns SET published_version = $2 WHERE id = $1', [patternId, count])
      for (const tester of array(spec.testers)) {
        const tid = await userId(db, str(tester.email))
        const version = whole(tester.version, 1)
        await db.query('INSERT INTO testers (pattern_id, user_id, version, row) VALUES ($1, $2, $3, $4)', [patternId, tid, version, whole(tester.row, 1)])
        for (const note of array(tester.notes)) {
          await db.query('INSERT INTO notes (pattern_id, user_id, version, row, text) VALUES ($1, $2, $3, $4, $5)', [patternId, tid, version, whole(note.row, 1), str(note.text)])
        }
      }
      for (const invite of array(spec.invites)) {
        const token = newToken()
        await db.query(`INSERT INTO invites (token, pattern_id, email, status, sent_at) VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval)`,
          [token, patternId, str(invite.email).toLowerCase(), invite.status === 'accepted' ? 'accepted' : 'sent', String(whole(invite.sentHoursAgo, 0))])
        invites.push({ token, email: str(invite.email).toLowerCase(), name: str(spec.name) })
      }
      return patternId
    })
    patterns[str(spec.key)] = id
    for (const tester of array(spec.testers)) await counterSet(id, await userId(pool, str(tester.email)), whole(tester.row, 1))
  }
  for (const invite of invites) {
    await sendMail(invite.email, `Test ${invite.name} on Twinrow`,
      `You are invited to test ${invite.name} on Twinrow.\n\nJoin from this link:\n${config.publicUrl}/invite/${invite.token}\n`)
  }
  ctx.reply(200, { users, patterns })
})

route('POST', '/api/grading/patterns/:id/hold-updates', 'public', async (ctx) => {
  guard(ctx)
  const body = object(ctx.body())
  holdUpdates(ctx.params.id, str(body.email).toLowerCase(), body.hold === true)
  ctx.reply(200, { held: body.hold === true })
})

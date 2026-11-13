import { CURRENCIES } from '../shared/i18n'
import { config } from './config'
import { notFound, validation } from './errors'
import { one, pool } from './db'
import { jsonBody, route, send, type Ctx } from './http'
import * as clock from './clock'
import * as storage from './storage'
import { announceClock, settle } from './scheduler'
import { startSession } from './accounts'
import { gradingSeed } from './grading'
import { announceAvailability } from './holds'
import { queueImages } from './images'

function guarded(handler: (ctx: Ctx) => Promise<void>): (ctx: Ctx) => Promise<void> {
  return async (ctx) => (config.grading ? handler(ctx) : notFound())
}

export function registerGrading(): void {
  route('POST', '/api/grading/seed', guarded(async (ctx) => {
    const body = await jsonBody(ctx)
    const seeded = await gradingSeed(body, ctx.now)
    queueImages(seeded.properties)
    for (const touch of seeded.touched) await announceAvailability(touch.property, touch.roomTypes, touch.dates)
    send(ctx.res, 201, seeded.result)
  }))

  route('POST', '/api/grading/session', guarded(async (ctx) => {
    const body = await jsonBody(ctx)
    const user = typeof body.username === 'string' ? await one<{ id: number; username: string; role: string }>(pool, `SELECT id, username, role FROM users WHERE username = $1`, [body.username.toLowerCase()]) : undefined
    if (!user) return notFound()
    await startSession(ctx, user.id)
    send(ctx.res, 200, { username: user.username, role: user.role })
  }))

  route('POST', '/api/grading/clock', guarded(async (ctx) => {
    const body = await jsonBody(ctx)
    if (typeof body.set === 'string' && !Number.isNaN(Date.parse(body.set))) await clock.setTo(new Date(body.set))
    else if (Number.isInteger(body.advance_ms)) await clock.advance(body.advance_ms as number)
    else return validation({ set: 'invalid' })
    await settle(true)
    await announceClock()
    send(ctx.res, 200, { now: clock.now().toISOString() })
  }))

  route('POST', '/api/grading/currency', guarded(async (ctx) => {
    const body = await jsonBody(ctx)
    const bad = CURRENCIES.filter((code) => !Number.isInteger(body[code]) || (body[code] as number) <= 0)
    if (bad.length) return validation(Object.fromEntries(bad.map((code) => [code, 'invalid'])))
    const table = Object.fromEntries(CURRENCIES.map((code) => [code, body[code]]))
    await pool.query(`INSERT INTO settings (key, value) VALUES ('currency', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(table)])
    send(ctx.res, 200, table)
  }))

  route('POST', '/api/grading/storage', guarded(async (ctx) => {
    const body = await jsonBody(ctx)
    if (typeof body.down !== 'boolean') return validation({ down: 'invalid' })
    storage.setDown(body.down)
    send(ctx.res, 200, { down: body.down })
  }))
}


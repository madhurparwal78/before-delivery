import { CURRENCIES, LANGS, type Currency, type Lang } from '../shared/i18n'
import { daysBetween, isRealDay } from '../shared/dates'
import { MAX_ADULTS } from '../shared/rules'
import type { PropertyView } from '../shared/types'
import { DATES_WINDOW_DAYS, MAX_NIGHTS, config } from './config'
import { fail, notFound, validation } from './errors'
import { one, pool, reachable, rows } from './db'
import { hashPassword, checkPassword, preferences, setCookie } from './auth'
import { ensureVisitor, jsonBody, limit, needUser, needVisitor, noContent, route, send, sendText } from './http'
import { emit, open } from './events'
import * as storage from './storage'
import { accountPayload, meView, startSession } from './accounts'
import { initialEvents } from './scheduler'
import { normalise, runSearch } from './search'
import { datesFor } from './dates'
import { getProperty, roomTypesOf, stayContext } from './catalog'
import { place, recommend, roomsLeft, type RoomTypeData } from './allocation'
import { currentRates, parseAges } from './quotes'
import { tierFor } from './loyalty'
import { scoresByProperty } from './reviews'
import { picture, PICTURE_COUNT } from './pictures'
import { canSee, loadRow } from './bookings'

const USERNAME = /^[a-z0-9_]{3,24}$/

export function registerCore(): void {
  route('GET', '/api/health', async ({ res }) => {
    if (!(await reachable())) return send(res, 503, { status: 'starting' })
    send(res, 200, { status: (await storage.healthy()) ? 'ok' : 'unavailable' })
  })

  route('GET', '/api/time', async (ctx) => {
    ensureVisitor(ctx)
    send(ctx.res, 200, { now: ctx.now.toISOString() })
  })

  route('GET', '/api/events', async (ctx) => {
    const visitor = ensureVisitor(ctx)
    const initial = await initialEvents(visitor, ctx.identity.user?.id ?? null, ctx.now)
    open(ctx.res, visitor, ctx.identity.user?.id ?? null, config.heartbeatMs, initial)
  })

  route('GET', '/api/currency', async ({ res }) => send(res, 200, await currentRates(pool)))

  route('GET', '/api/destinations', async (ctx) => {
    const q = (ctx.query.get('q') ?? '').toLowerCase()
    const found = await rows(
      pool,
      `SELECT d.code, d.name, d.zone, d.cx, d.cy, (SELECT count(*) FROM properties p WHERE p.destination = d.code)::int AS property_count
         FROM destinations d WHERE position($1 in lower(d.name)) > 0 ORDER BY d.name`,
      [q],
    )
    send(ctx.res, 200, found)
  })

  route('POST', '/api/signup', async (ctx) => {
    const body = await jsonBody(ctx)
    const username = typeof body.username === 'string' ? body.username.toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const fields: Record<string, string> = {}
    if (!USERNAME.test(username)) fields.username = 'signup.username'
    if (password.length < 8) fields.password = 'signup.password'
    if (Object.keys(fields).length) return validation(fields)
    const created = await one<{ id: number }>(pool, `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'guest') ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hashPassword(password)])
    if (!created) return fail(409, 'username_taken')
    await startSession(ctx, created.id)
    send(ctx.res, 201, { username, role: 'guest' })
  })

  route('POST', '/api/signin', async (ctx) => {
    const body = await jsonBody(ctx)
    const username = typeof body.username === 'string' ? body.username.toLowerCase() : ''
    limit('signin', username, config.loginRate)
    const user = await one<{ id: number; username: string; role: string; password_hash: string }>(pool, `SELECT * FROM users WHERE username = $1`, [username])
    if (!user || typeof body.password !== 'string' || !checkPassword(body.password, user.password_hash)) return fail(401, 'bad_credentials')
    await startSession(ctx, user.id)
    const manages = await rows<{ property: string }>(pool, `SELECT property FROM manages WHERE user_id = $1 ORDER BY property`, [user.id])
    send(ctx.res, 200, { username: user.username, role: user.role, manages: manages.map((m) => m.property) })
  })

  route('POST', '/api/signout', async (ctx) => {
    if (ctx.identity.session) await pool.query(`DELETE FROM sessions WHERE id = $1`, [ctx.identity.session])
    setCookie(ctx.res, 'kip_session', '', 0)
    noContent(ctx.res)
  })

  route('POST', '/api/signout-everywhere', async (ctx) => {
    const user = needUser(ctx)
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id])
    setCookie(ctx.res, 'kip_session', '', 0)
    await emit({ name: 'account.changed', data: await accountPayload(user.id, ctx.now, true), target: { user: user.id } })
    noContent(ctx.res)
  })

  route('GET', '/api/me', async (ctx) => send(ctx.res, 200, await meView(ctx.identity, ctx.now)))

  route('PATCH', '/api/me/preferences', async (ctx) => {
    const body = await jsonBody(ctx)
    const visitor = needVisitor(ctx)
    const fields: Record<string, string> = {}
    if (body.lang !== undefined && !LANGS.includes(body.lang as Lang)) fields.lang = 'invalid'
    if (body.cur !== undefined && !CURRENCIES.includes(body.cur as Currency)) fields.cur = 'invalid'
    if (Object.keys(fields).length) return validation(fields)
    const before = await preferences(ctx.identity)
    const next = { lang: (body.lang as Lang | undefined) ?? before.lang, cur: (body.cur as Currency | undefined) ?? before.cur }
    if (ctx.identity.session) await pool.query(`UPDATE sessions SET lang = $2, cur = $3 WHERE id = $1`, [ctx.identity.session, next.lang, next.cur])
    else await pool.query(`INSERT INTO visitors (id, lang, cur) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET lang = EXCLUDED.lang, cur = EXCLUDED.cur`, [visitor, next.lang, next.cur])
    const view = await meView(ctx.identity, ctx.now)
    send(ctx.res, 200, view)
    await emit({ name: 'account.changed', data: await accountPayload(ctx.identity.user?.id ?? null, ctx.now, false, next), target: { visitor, user: ctx.identity.user?.id ?? null } })
  })

  route('GET', '/api/inbox', async (ctx) => {
    const found = await rows<{ id: number; at: Date; kind: string; name: string; link: string }>(
      pool,
      `SELECT i.id, i.at, i.kind, p.name, i.link FROM inbox i JOIN properties p ON p.code = i.property
        WHERE (i.user_id IS NOT NULL AND i.user_id = $1) OR (i.visitor IS NOT NULL AND i.visitor = $2) ORDER BY i.at DESC, i.id DESC`,
      [ctx.identity.user?.id ?? null, ctx.identity.visitor],
    )
    send(ctx.res, 200, found.map((m) => ({ id: m.id, at: m.at.toISOString(), kind: m.kind, property: m.name, link: m.link })))
  })

  route('GET', '/api/search', async (ctx) => {
    limit('search', ctx.identity.visitor ?? ctx.req.socket.remoteAddress ?? 'anonymous', config.searchRate)
    const prefs = await preferences(ctx.identity)
    const norm = await normalise(pool, ctx.query, prefs, ctx.now)
    send(ctx.res, 200, await runSearch(pool, norm, ctx.now, ctx.identity.user?.id ?? null))
  })

  route('GET', '/api/dates', async (ctx) => {
    const from = ctx.query.get('from') ?? ''
    const to = ctx.query.get('to') ?? ''
    const cur = ctx.query.get('cur') ?? 'EUR'
    const start = ctx.query.get('start')
    const fields: Record<string, string> = {}
    if (!isRealDay(from)) fields.from = 'invalid'
    if (!isRealDay(to) || to < from || daysBetween(from, to) > DATES_WINDOW_DAYS) fields.to = 'invalid'
    if (!CURRENCIES.includes(cur as Currency)) fields.cur = 'invalid'
    if (start !== null && !isRealDay(start)) fields.start = 'invalid'
    if (Object.keys(fields).length) return validation(fields)
    let ignore: string | null = null
    const booking = ctx.query.get('booking')
    if (booking) {
      const row = await loadRow(pool, booking)
      if (row && (await canSee(pool, row, { visitor: ctx.identity.visitor, user: ctx.identity.user }))) ignore = row.code
    }
    send(ctx.res, 200, await datesFor(pool, { dest: ctx.query.get('dest') ?? undefined, property: ctx.query.get('property') ?? undefined }, from, to, cur as Currency, start, ignore, ctx.now))
  })

  route('GET', '/api/properties/:code', async (ctx) => {
    const property = await getProperty(pool, ctx.params.code)
    if (!property) return notFound()
    const roomTypes = (await roomTypesOf(pool, [property.code])).get(property.code) as RoomTypeData[]
    const dest = await one<{ cx: number; cy: number }>(pool, `SELECT cx, cy FROM destinations WHERE code = $1`, [property.destination])
    const arrival = ctx.query.get('in')
    const departure = ctx.query.get('out')
    const dated = isRealDay(arrival) && isRealDay(departure) && departure > arrival && daysBetween(arrival, departure) <= MAX_NIGHTS
    const adults = Number(ctx.query.get('adults') ?? 2)
    const ages = parseAges((ctx.query.get('ages') ?? '').split(',').filter(Boolean).map(Number))
    const tier = await tierFor(pool, ctx.identity.user?.id ?? null, ctx.now)
    let recommendation = null
    let left = new Map(roomTypes.map((room) => [room.code, room.rooms]))
    if (dated) {
      const stay = await stayContext(pool, property, roomTypes, arrival, departure, ctx.now, tier.pct)
      left = new Map(roomTypes.map((room) => [room.code, Math.min(room.rooms, roomsLeft(stay.nights.get(room.code)!, arrival, departure))]))
      if (Number.isInteger(adults) && adults >= 1 && adults <= MAX_ADULTS && ages) recommendation = recommend(stay, { adults, ages })
    }
    const score = (await scoresByProperty(pool, [property.code], ctx.now)).get(property.code) as number
    const view: PropertyView = {
      code: property.code, name: property.name, zone: property.zone, stars: property.stars, amenities: property.amenities, score: score / 10,
      distance_km: Math.round(Math.hypot(property.x - (dest?.cx ?? 0), property.y - (dest?.cy ?? 0)) * 10) / 10,
      pictures: Array.from({ length: PICTURE_COUNT }, (_, i) => `/images/${property.code}/${i + 1}.svg`), policy: property.policy,
      room_types: roomTypes.map((room) => ({ code: room.code, name: room.name, max_adults: room.max_adults, max_guests: room.max_guests, left: left.get(room.code) as number })),
      recommendation: recommendation ? { rooms: recommendation.rooms, total_minor: recommendation.total } : null,
    }
    send(ctx.res, 200, view)
  })

  route('POST', '/api/allocations', async (ctx) => {
    const body = await jsonBody(ctx)
    const property = await getProperty(pool, String(body.property))
    if (!property) return notFound()
    const fields: Record<string, string> = {}
    if (!isRealDay(body.in)) fields.in = 'invalid'
    if (!isRealDay(body.out)) fields.out = 'invalid'
    const ages = parseAges(body.ages)
    if (!ages) fields.ages = 'invalid'
    if (!Number.isInteger(body.adults) || (body.adults as number) < 1 || (body.adults as number) > MAX_ADULTS) fields.adults = 'out_of_range'
    const counts = body.counts as Record<string, unknown> | undefined
    if (!counts || typeof counts !== 'object' || Object.values(counts).some((n) => !Number.isInteger(n) || (n as number) < 0)) fields.counts = 'invalid'
    if (Object.keys(fields).length) return validation(fields)
    const roomTypes = (await roomTypesOf(pool, [property.code])).get(property.code) as RoomTypeData[]
    if (Object.keys(counts as object).some((code) => !roomTypes.some((room) => room.code === code))) return validation({ counts: 'invalid' })
    const tier = await tierFor(pool, ctx.identity.user?.id ?? null, ctx.now)
    const stay = await stayContext(pool, property, roomTypes, body.in as string, body.out as string, ctx.now, tier.pct)
    const placed = place(stay, { adults: body.adults as number, ages: ages as number[] }, counts as Record<string, number>)
    if ('code' in placed) return fail(422, 'room_advice', { advice: placed })
    send(ctx.res, 200, { rooms: placed.rooms, total_minor: placed.total })
  })

  route('GET', '/images/:code/:file', async (ctx) => {
    const n = Number(ctx.params.file.replace(/\.svg$/, ''))
    const property = await getProperty(pool, ctx.params.code)
    if (!property || !/^\d+\.svg$/.test(ctx.params.file) || n < 1 || n > PICTURE_COUNT) return notFound()
    try {
      const key = `images/${property.code}/${n}.svg`
      let body = await storage.get(key)
      if (!body) {
        await storage.put(key, picture(property.code, n), 'image/svg+xml')
        body = await storage.get(key)
      }
      sendText(ctx.res, 200, 'image/svg+xml', body as Buffer, { 'cache-control': 'public, max-age=300' })
    } catch (error) {
      if (error instanceof storage.StorageUnavailable) return fail(503, 'storage_unavailable')
      throw error
    }
  })
}

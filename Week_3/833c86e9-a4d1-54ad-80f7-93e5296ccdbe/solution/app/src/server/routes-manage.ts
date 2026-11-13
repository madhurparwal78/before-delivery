import { isRealDay } from '../shared/dates'
import { CALENDAR_WINDOW_DAYS, config } from './config'
import { fail, notFound, validation } from './errors'
import { pool, rows, tx } from './db'
import { jsonBody, rawBody, route, send, sendText, type Ctx } from './http'
import { afterEdit, calendar, editNights, liveQuotes, requireManager } from './manage'
import { applyChanges, digest, parseImport, planChanges } from './imports'
import { downloadable, months, reservations, reservationsCsv, statement, statementCsv } from './statements'
import { getProperty } from './catalog'
import * as storage from './storage'

async function managed(ctx: Ctx): Promise<{ code: string; zone: string }> {
  const code = ctx.params.code
  requireManager(ctx.identity, code)
  const property = await getProperty(pool, code)
  if (!property) return notFound()
  return { code, zone: property.zone }
}

const attachment = (name: string): Record<string, string> => ({ 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`, 'cache-control': 'no-store' })

async function managedPlan(code: string, bytes: Buffer) {
  const rooms = new Set((await rows<{ code: string }>(pool, `SELECT code FROM room_types WHERE property = $1`, [code])).map((room) => room.code))
  return parseImport(bytes, rooms)
}

export function registerManage(): void {
  route('GET', '/api/manage/:code/calendar', async (ctx) => {
    const { code } = await managed(ctx)
    const from = ctx.query.get('from') ?? ''
    const days = Number(ctx.query.get('days') ?? 28)
    if (!isRealDay(from) || !Number.isInteger(days) || days < 1 || days > CALENDAR_WINDOW_DAYS) return validation({ [isRealDay(from) ? 'days' : 'from']: 'invalid' })
    send(ctx.res, 200, await calendar(pool, code, from, days, ctx.now))
  })

  route('PATCH', '/api/manage/:code/nights', async (ctx) => {
    const body = await jsonBody(ctx)
    const { code } = await managed(ctx)
    const result = await tx((client) => editNights(client, code, body, ctx.now))
    await afterEdit(code, result, ctx.now)
    send(ctx.res, 200, { changed_nights: result.changed_nights, season: result.season })
  })

  route('GET', '/api/manage/:code/reservations', async (ctx) => {
    const { code } = await managed(ctx)
    send(ctx.res, 200, await reservations(pool, code))
  })

  route('GET', '/api/manage/:code/reservations.csv', async (ctx) => {
    const { code } = await managed(ctx)
    sendText(ctx.res, 200, 'text/csv; charset=utf-8', reservationsCsv(await reservations(pool, code)), attachment(`reservations-${code}.csv`))
  })

  route('POST', '/api/manage/:code/imports/preview', async (ctx) => {
    const bytes = await rawBody(ctx, config.importMaxBytes)
    const { code } = await managed(ctx)
    const parsed = await managedPlan(code, bytes)
    if (parsed.errors.length) return fail(422, 'import_invalid', { lines: parsed.errors })
    const changes = await planChanges(pool, parsed.entries)
    send(ctx.res, 200, { sha256: digest(bytes), changes: changes.map(({ room, date, old_minor, new_minor }) => ({ room, date, old_minor, new_minor })), count: changes.length })
  }, true)

  route('POST', '/api/manage/:code/imports', async (ctx) => {
    const bytes = await rawBody(ctx, config.importMaxBytes)
    const { code } = await managed(ctx)
    const parsed = await managedPlan(code, bytes)
    if (parsed.errors.length) return fail(422, 'import_invalid', { lines: parsed.errors })
    const sha256 = digest(bytes)
    const key = `imports/${code}/${sha256}.kiprates`
    try {
      await storage.put(key, bytes, 'application/octet-stream')
    } catch (error) {
      if (error instanceof storage.StorageUnavailable) return fail(503, 'storage_unavailable')
      throw error
    }
    const changes = await tx(async (client) => {
      const planned = await planChanges(client, parsed.entries)
      await applyChanges(client, planned)
      return planned
    })
    if (changes.length) {
      const dates = changes.map((change) => change.date).sort()
      const result = { changed_nights: changes.length, season: null, stale: await liveQuotes(pool, code, dates[0], dates[dates.length - 1], ctx.now), touched: { roomTypes: [...new Set(changes.map((change) => change.room))], dates: [...new Set(dates)] } }
      await afterEdit(code, result, ctx.now)
    }
    send(ctx.res, 201, { sha256, count: changes.length, key })
  }, true)

  route('GET', '/api/manage/:code/statements/:month', async (ctx) => {
    const { code, zone } = await managed(ctx)
    const csv = ctx.params.month.endsWith('.csv')
    const month = ctx.params.month.replace(/\.csv$/, '')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return notFound()
    if (!csv) {
      const data = await statement(pool, code, zone, month)
      return send(ctx.res, 200, { ...data, downloadable: downloadable(month, zone, ctx.now), months: await months(pool, code, zone, ctx.now) })
    }
    if (!downloadable(month, zone, ctx.now)) return fail(409, 'month_open')
    try {
      const key = `statements/${code}/${month}.csv`
      let body = await storage.get(key)
      if (!body) {
        await storage.put(key, statementCsv(await statement(pool, code, zone, month)), 'text/csv; charset=utf-8')
        body = await storage.get(key)
      }
      sendText(ctx.res, 200, 'text/csv; charset=utf-8', body as Buffer, attachment(`statement-${code}-${month}.csv`))
    } catch (error) {
      if (error instanceof storage.StorageUnavailable) return fail(503, 'storage_unavailable')
      throw error
    }
  })
}

/** Sign-up, sign-in, sign-out and account endpoints. */
import { route, type RouteContext } from './router.js'
import { ApiError, send_json, send_empty } from './http.js'
import { create_session, destroy_session, set_session_cookie, clear_session_cookie, read_session_cookie } from './session.js'
import { hash_password, verify_password } from './seed_data.js'

function user_body(caller: { id: number; email: string; name: string; role: string; trade_status: string | null; dial_mode: string }): Record<string, unknown> {
  return { id: caller.id, email: caller.email, name: caller.name, role: caller.role, trade_status: caller.trade_status, dial_mode: caller.dial_mode }
}

export function auth_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'POST', '/api/auth/signup', async (ctx: RouteContext) => {
    const body = ctx.body
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    const password = typeof body['password'] === 'string' ? body['password'] : ''
    const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
    const account_type = body['account_type']
    const errors: Record<string, string> = {}
    if (email === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors['email'] = 'invalid'
    if (password.length < 10) errors['password'] = 'too_short'
    if (name === '') errors['name'] = 'required'
    let trade: Record<string, unknown> | null = null
    if (account_type === 'trade') {
      trade = (body['trade'] ?? null) as Record<string, unknown> | null
      if (!trade || typeof trade !== 'object') errors['trade'] = 'required'
    } else if (account_type !== 'retail') {
      errors['account_type'] = 'invalid'
    }
    let business_name = ''
    let nzbn = ''
    let occupation = ''
    if (trade) {
      business_name = typeof trade['business_name'] === 'string' ? trade['business_name'].trim() : ''
      nzbn = typeof trade['nzbn'] === 'string' ? trade['nzbn'].trim() : ''
      occupation = typeof trade['occupation'] === 'string' ? trade['occupation'] : ''
      if (business_name === '') errors['business_name'] = 'required'
      if (!/^94\d{11}$/.test(nzbn)) errors['nzbn'] = 'invalid'
      if (!['electrician', 'architect', 'lighting_designer', 'wholesaler'].includes(occupation)) errors['occupation'] = 'invalid'
    }
    if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)

    const existing = await ctx.client.query(`SELECT 1 FROM users WHERE email=$1`, [email])
    if (existing.rowCount !== 0) throw new ApiError(409, 'email_taken')

    const role = account_type === 'trade' ? 'trade' : 'retail'
    const trade_status = account_type === 'trade' ? 'submitted' : null
    const created = await ctx.client.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, name, role, trade_status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, hash_password(password), name, role, trade_status],
    )
    const user_id = created.rows[0]!.id
    if (trade) {
      await ctx.client.query(
        `INSERT INTO trade_applications (user_id, business_name, nzbn, occupation, status) VALUES ($1,$2,$3,$4,'submitted')`,
        [user_id, business_name, nzbn, occupation],
      )
    }
    const token = await create_session(ctx.client, user_id)
    set_session_cookie(ctx.res, token)
    const row = await ctx.client.query(`SELECT id, email, name, role, trade_status, dial_mode FROM users WHERE id=$1`, [user_id])
    send_json(ctx.res, 201, { user: user_body(row.rows[0]!) })
  })

  route(api, 'POST', '/api/auth/signin', async (ctx: RouteContext) => {
    const body = ctx.body
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    const password = typeof body['password'] === 'string' ? body['password'] : ''
    const row = await ctx.client.query(
      'SELECT id, email, name, role, trade_status, dial_mode, password_hash FROM users WHERE email=$1',
      [email],
    )
    const user = row.rows[0]
    if (!user || !verify_password(password, user.password_hash)) {
      throw new ApiError(401, 'invalid_credentials')
    }
    const token = await create_session(ctx.client, user.id)
    set_session_cookie(ctx.res, token)
    send_json(ctx.res, 200, { user: user_body(user) })
  })

  route(api, 'POST', '/api/auth/signout', async (ctx: RouteContext) => {
    const token = read_session_cookie(ctx.req)
    if (token) await destroy_session(ctx.client, token)
    clear_session_cookie(ctx.res)
    send_empty(ctx.res, 204)
  })

  route(api, 'GET', '/api/me', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    send_json(ctx.res, 200, { user: user_body(ctx.caller) })
  })

  route(api, 'PUT', '/api/me/dial', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const body = ctx.body
    const mode = body['mode']
    if (typeof mode !== 'string' || !['auto', 'morning', 'day', 'evening', 'night', 'gallery'].includes(mode)) {
      throw new ApiError(422, 'validation_failed', { mode: 'invalid' })
    }
    await ctx.client.query('UPDATE users SET dial_mode=$1 WHERE id=$2', [mode, ctx.caller.id])
    send_json(ctx.res, 200, { dial_mode: mode })
  })
}
